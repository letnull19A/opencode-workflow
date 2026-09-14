import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { IWebhookBinding, IWebhookStore } from "../core/webhook.ts";

/** Файловый стор биндингов вебхуков: по одному json на id в STATE_DIR/hooks. */
export class FileWebhookStore implements IWebhookStore {
  constructor(private readonly stateDir?: string) {}

  private dir(): string {
    return join(
      this.stateDir ?? process.env.STATE_DIR ?? join(homedir(), ".local", "state", "opencode-workflow"),
      "hooks"
    );
  }

  private fileFor(id: string): string {
    return join(this.dir(), `${id}.json`);
  }

  async save(binding: IWebhookBinding): Promise<void> {
    await mkdir(this.dir(), { recursive: true });
    await writeFile(this.fileFor(binding.id), JSON.stringify(binding, null, 2), "utf8");
  }

  async load(id: string): Promise<IWebhookBinding | null> {
    try {
      const raw = await readFile(this.fileFor(id), "utf8");
      return JSON.parse(raw) as IWebhookBinding;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") console.warn(`webhook binding read failed: ${id}: ${String(err)}`);
      return null;
    }
  }

  async list(): Promise<IWebhookBinding[]> {
    const entries = await readdirSafe(this.dir());
    const bindings: IWebhookBinding[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const binding = await this.load(entry.slice(0, -5));
      if (binding) bindings.push(binding);
    }
    return bindings.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async remove(id: string): Promise<void> {
    await unlink(this.fileFor(id)).catch((err) => {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") throw err;
    });
  }
}

async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return [];
    throw err;
  }
}