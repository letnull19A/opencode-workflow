import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { IPipelineState, IPipelineStateStore } from "../core/pipeline.ts";

/** Файловый стор состояний пайплайна: по файлу на runId в ~/.local/state/opencode-workflow. */
export class FilePipelineStateStore implements IPipelineStateStore {
  constructor(private readonly stateDir?: string) {}

  private dir(): string {
    return this.stateDir ?? process.env.STATE_DIR ?? join(homedir(), ".local", "state", "opencode-workflow");
  }

  private fileFor(runId: string): string {
    return join(this.dir(), `${runId}.json`);
  }

  async load(runId: string): Promise<IPipelineState | null> {
    try {
      const raw = await readFile(this.fileFor(runId), "utf8");
      return JSON.parse(raw) as IPipelineState;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") console.warn(`state read failed: ${runId}: ${String(err)}`);
      return null;
    }
  }

  async save(state: IPipelineState): Promise<void> {
    await mkdir(this.dir(), { recursive: true });
    await writeFile(this.fileFor(state.runId), JSON.stringify(state, null, 2), "utf8");
  }
}