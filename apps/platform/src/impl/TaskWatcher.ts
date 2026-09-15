import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IEventBus } from "../core/events.ts";
import type { ILogger } from "../core/logging.ts";
import type { IPositionedTaskSource, ITaskPosition } from "../core/moves.ts";
import type { IWorkflowTask, ITaskSource } from "@opencode-workflow/sdk";
import { makeLogger } from "./logger.ts";

export interface TaskWatcherOptions {
  pollIntervalMs?: number;
  processedFile?: string;
  positionsFile?: string;
}

/**
 * Поллинг-мост: источник → шина. Новые задачи (отсутствующие в
 * processed.json) публикуются как task.received, после чего ack'аются.
 * Если источник реализует IPositionedTaskSource, тот же полл снимает карту
 * «карточка → лист», диффит её с positions.json и публикует task.moved —
 * первый полл только семенит снапшот, события не шлёт.
 * Состояния processed/positions — state-файлы, устойчивые к перезапуску.
 */
export class TaskWatcher {
  private timer?: ReturnType<typeof setTimeout>;
  private readonly stateDir = process.env.STATE_DIR
    ?? join(process.env.HOME ?? ".", ".local", "state", "opencode-workflow");
  private readonly processedFile: string;
  private readonly positionsFile: string;
  private readonly log: ILogger;

  constructor(
    private readonly source: ITaskSource,
    private readonly bus: IEventBus,
    options: TaskWatcherOptions = {},
    log: ILogger = makeLogger("watch")
  ) {
    this.processedFile = options.processedFile ?? join(this.stateDir, "processed.json");
    this.positionsFile = options.positionsFile ?? join(this.stateDir, "positions.json");
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

    let moved = 0;
    if (isPositioned(this.source)) {
      moved = await this.diffPositions(await this.source.fetchPositions());
    }
    this.log.info(`poll ${this.source.id}: ${fresh} new, ${moved} moved, ${processed.size} processed`);
  }

  private async diffPositions(positions: ITaskPosition[]): Promise<number> {
    const before = await this.loadPositions();
    const next = new Map<string, string>();
    let moved = 0;
    for (const position of positions) {
      const id = position.task.externalId;
      const previous = before.get(id);
      next.set(id, position.list);
      if (previous === undefined) continue;
      if (previous === position.list) continue;
      moved += 1;
      const task = withMove(position.task, previous, position.list);
      this.bus.publish({ type: "task.moved", task, fromList: previous, toList: position.list });
    }
    await this.savePositions(next);
    return moved;
  }

  private async loadPositions(): Promise<Map<string, string>> {
    try {
      const raw = await readFile(this.positionsFile, "utf8");
      const parsed = JSON.parse(raw) as { positions?: Record<string, string> };
      return new Map(Object.entries(parsed.positions ?? {}));
    } catch {
      return new Map();
    }
  }

  private async savePositions(positions: Map<string, string>): Promise<void> {
    await mkdir(this.stateDir, { recursive: true });
    await writeFile(
      this.positionsFile,
      JSON.stringify({ positions: Object.fromEntries(positions) }, null, 2),
      "utf8"
    );
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

export function isPositioned(source: ITaskSource): source is IPositionedTaskSource {
  return typeof (source as Partial<IPositionedTaskSource>).fetchPositions === "function";
}

/** Копия задачи с meta.move = { fromList, toList } для workflow-реакторов. */
export function withMove(
  task: IWorkflowTask,
  fromList: string,
  toList: string
): IWorkflowTask {
  return {
    ...task,
    meta: {
      ...(task.meta as Readonly<Record<string, unknown>> | undefined),
      move: { fromList, toList },
    },
  };
}