import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IEventBus } from "../core/events.ts";
import type { ILogger } from "../core/logging.ts";
import type { ITaskSource } from "@opencode-workflow/sdk";
import { makeLogger } from "./logger.ts";

export interface TaskWatcherOptions {
  pollIntervalMs?: number;
  processedFile?: string;
}

/**
 * Поллинг-мост: источник → шина. Новые задачи (отсутствующие в
 * processed.json) публикуются как task.received, после чего ack'аются.
 * Состояние processed — state-файл, устойчив к перезапуску.
 */
export class TaskWatcher {
  private timer?: ReturnType<typeof setTimeout>;
  private readonly stateDir = process.env.STATE_DIR
    ?? join(process.env.HOME ?? ".", ".local", "state", "opencode-workflow");
  private readonly processedFile: string;
  private readonly log: ILogger;

  constructor(
    private readonly source: ITaskSource,
    private readonly bus: IEventBus,
    options: TaskWatcherOptions = {},
    log: ILogger = makeLogger("watch")
  ) {
    this.processedFile = options.processedFile ?? join(this.stateDir, "processed.json");
    this.log = log;
  }

  async start(): Promise<void> {
    const interval = this.pollIntervalMs();
    await this.pollOnce();
    this.timer = setInterval(() => void this.pollOnce().catch((err) => console.error(String(err))), interval);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
  }

  private pollIntervalMs(): number {
    const raw = process.env.TASK_POLL_INTERVAL_MS;
    return raw ? Number(raw) : 30_000;
  }

  private async pollOnce(): Promise<void> {
    const processed = await this.loadProcessed();
    const tasks = await this.source.fetchNewTasks();
    let fresh = 0;
    for (const task of tasks) {
      if (processed.has(task.externalId)) continue;
      fresh += 1;
      this.bus.publish({ type: "task.received", task });
      await this.source.ackTask(task);
      processed.add(task.externalId);
    }
    await this.saveProcessed(processed);
    this.log.info(`poll ${this.source.id}: ${fresh} new, ${processed.size} processed`);
  }

  private async loadProcessed(): Promise<Set<string>> {
    try {
      const raw = await readFile(this.processedFile, "utf8");
      const parsed = JSON.parse(raw) as { ids?: string[] };
      return new Set(parsed.ids ?? []);
    } catch {
      return new Set();
    }
  }

  private async saveProcessed(processed: Set<string>): Promise<void> {
    await mkdir(this.stateDir, { recursive: true });
    await writeFile(this.processedFile, JSON.stringify({ ids: [...processed] }, null, 2), "utf8");
  }
}