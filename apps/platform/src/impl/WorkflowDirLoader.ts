import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { workflowFormat, sdkVersion } from "@opencode-workflow/sdk";
import type { IWorkflowDefinition } from "@opencode-workflow/sdk";
import type { IEventBus } from "../core/events.ts";
import type { IWorkflowRegistry } from "../core/workflows.ts";
import { GraphWorkflow, type GraphWorkflowServices } from "./GraphWorkflow.ts";

/** Манифест собранного workflow-артефакта: контрактный гейт до загрузки кода. */
export interface WorkflowManifest {
  format: number;
  id: string;
  label: string;
  phases?: readonly string[];
  sdkVersion: string;
}

/**
 * Загрузчик каталога workflow-артефактов (WORKFLOWS_DIR).
 * Каждая workflow — директория <id>/ с manifest.json + index.js (собран
 * build-workflow с инлайн-SDK). sync() сканирует каталог, гонит артефакт
 * через гейт формата, импортирует определение и регистрирует GraphWorkflow.
 * Различие по mtime дирфы регистрирует/обновляет; отсутствующие — снимает.
 * Ошибки конкретного артефакта не роняют остальные (workflow.error + лог).
 */
export class WorkflowDirLoader {
  private readonly mtimes = new Map<string, number>();

  constructor(
    private readonly dir: string,
    private readonly registry: IWorkflowRegistry,
    private readonly services: GraphWorkflowServices,
    private readonly bus: IEventBus
  ) {}

  /** Полный обход каталога: регистрация новых/изменённых, снятие отсутствующих. */
  async sync(): Promise<void> {
    const foundIds = new Set<string>();
    const seenDirs = new Set<string>();
    const entries = await this.readDir();
    for (const entry of entries) {
      const artifactDir = join(this.dir, entry);
      const stat = await this.stat(artifactDir);
      if (!stat?.isDirectory()) continue;
      seenDirs.add(artifactDir);

      const manifest = await this.readManifest(artifactDir);
      if (!manifest) continue;
      const gate = this.gate(manifest, entry);
      if (!gate.ok) {
        this.report(manifest.id, gate.error ?? "unknown");
        continue;
      }
      foundIds.add(manifest.id);

      const previous = this.mtimes.get(artifactDir);
      const fingerprint = await this.fingerprint(artifactDir);
      if (previous === undefined) {
        await this.load(manifest, artifactDir);
      } else if (fingerprint > previous) {
        await this.load(manifest, artifactDir, true);
      }
    }
    await this.removeMissing(foundIds, seenDirs);
  }

  private async fingerprint(artifactDir: string): Promise<number> {
    const files = ["index.js", "manifest.json"];
    let max = 0;
    for (const file of files) {
      const st = await this.stat(join(artifactDir, file));
      if (st && st.mtimeMs > max) max = st.mtimeMs;
    }
    if (max === 0) max = Date.now();
    return max;
  }

  private async readDir(): Promise<string[]> {
    const { readdir } = await import("node:fs/promises");
    try {
      return await readdir(this.dir);
    } catch {
      return [];
    }
  }

  private async stat(path: string): Promise<{ isDirectory(): boolean; mtimeMs: number } | undefined> {
    try {
      const { stat } = await import("node:fs/promises");
      return await stat(path);
    } catch {
      return undefined;
    }
  }

  private async readManifest(artifactDir: string): Promise<WorkflowManifest | null> {
    try {
      const raw = await readFile(join(artifactDir, "manifest.json"), "utf8");
      const parsed = JSON.parse(raw) as Partial<WorkflowManifest>;
      if (typeof parsed.id !== "string" && typeof parsed.label !== "string") return null;
      return {
        format: typeof parsed.format === "number" ? parsed.format : -1,
        id: typeof parsed.id === "string" ? parsed.id : (parsed.label as string),
        label: typeof parsed.label === "string" ? parsed.label : (parsed.id as string),
        phases: Array.isArray(parsed.phases) ? parsed.phases.map(String) : undefined,
        sdkVersion: typeof parsed.sdkVersion === "string" ? parsed.sdkVersion : "",
      };
    } catch {
      return null;
    }
  }

  private gate(manifest: WorkflowManifest, entry: string): { ok: boolean; error?: string } {
    if (manifest.format !== workflowFormat) {
      return { ok: false, error: `format ${manifest.format} не поддерживается (нужен ${workflowFormat})` };
    }
    if (manifest.sdkVersion !== sdkVersion) {
      return {
        ok: false,
        error: `sdk ${manifest.sdkVersion} ≠ платформенный ${sdkVersion}; пересобери через build-workflow`,
      };
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(manifest.id)) {
      return { ok: false, error: `id "${manifest.id}" нарушает формат [a-z0-9-]` };
    }
    if (manifest.id !== entry) {
      return { ok: false, error: `каталог "${entry}" ≠ id "${manifest.id}"` };
    }
    return { ok: true };
  }

  private async load(manifest: WorkflowManifest, artifactDir: string, updated = false): Promise<void> {
    const fingerprint = await this.fingerprint(artifactDir);
    const mtime = fingerprint;
    const importPath = `${pathToFileURL(join(artifactDir, "index.js")).href}?t=${mtime}`;
    try {
      const mod = (await import(importPath)) as { default?: IWorkflowDefinition };
      if (!mod.default || typeof mod.default !== "object") {
        throw new Error("index.js не default-экспортирует IWorkflowDefinition");
      }
      const handle = new GraphWorkflow(mod.default, this.services);
      if (this.registry.resolve(manifest.id)) {
        this.registry.unregister(manifest.id);
      }
      this.registry.register(handle);
      this.mtimes.set(artifactDir, mtime);
      this.bus.publish({
        type: updated ? "workflow.updated" : "workflow.registered",
        workflowId: handle.id,
        label: handle.label,
        phases: handle.phases,
      });
    } catch (err) {
      this.report(manifest.id, String(err));
    }
  }

  private async removeMissing(foundIds: Set<string>, seenDirs: Set<string>): Promise<void> {
    for (const existing of this.registry.list()) {
      if (existing.id === "module") continue;
      if (foundIds.has(existing.id)) continue;
      this.registry.unregister(existing.id);
      this.bus.publish({ type: "workflow.removed", workflowId: existing.id });
    }
    for (const artifactDir of [...this.mtimes.keys()]) {
      if (!seenDirs.has(artifactDir)) this.mtimes.delete(artifactDir);
    }
  }

  private report(workflowId: string, error: string): void {
    console.error(`[workflows] ${workflowId}: ${error}`);
    this.bus.publish({ type: "workflow.error", workflowId, error });
  }
}