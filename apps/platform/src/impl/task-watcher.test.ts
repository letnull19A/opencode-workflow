import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryEventBus } from "./InMemoryEventBus.ts";
import { isPositioned, TaskWatcher, withMove } from "./TaskWatcher.ts";
import type { IPositionedTaskSource, ITaskPosition } from "../core/moves.ts";
import type { WorkflowEvent } from "../core/events.ts";
import type { ILogger } from "../core/logging.ts";
import type { IWorkflowTask, ITaskSource } from "@opencode-workflow/sdk";

const task = (id: string): IWorkflowTask => ({
  externalId: id,
  source: "trello",
  title: id,
  url: `https://trello.com/c/${id}`,
  createdAt: new Date().toISOString(),
});

const noopLogger: ILogger = { level: "silent", debug: noop, info: noop, warn: noop, error: noop };
function noop(..._args: unknown[]): void {}

/** Источник c подменяемыми позициями/inbox между поллами. */
function makePositionedSource(
  initial: ITaskPosition[],
  inbox: IWorkflowTask[]
): IPositionedTaskSource & ITaskSource & { setPositions(positions: ITaskPosition[]): void } {
  let positions = initial;
  const source = {
    id: "trello-test",
    fetchNewTasks: async () => inbox,
    ackTask: async () => {},
    fetchPositions: async () => positions,
    setPositions(next: ITaskPosition[]) {
      positions = next;
    },
  };
  return source;
}

describe("withMove", () => {
  test("добавляет meta.move без мутации исходной задачи", () => {
    const source = task("c1");
    const moved = withMove(source, "Backlog", "This Week");
    expect(moved.meta).toEqual({ move: { fromList: "Backlog", toList: "This Week" } });
    expect(source.meta).toBeUndefined();
  });
});

describe("TaskWatcher move-diff", () => {
  test("первый полл только семенит positions.json, затем шлёт task.moved", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tw-"));
    const bus = new InMemoryEventBus();
    const events: WorkflowEvent[] = [];
    const off = bus.subscribe((e) => events.push(e));
    const source = makePositionedSource([{ task: task("c1"), list: "Backlog" }], []);
    const watcher = new TaskWatcher(source, bus, {
      processedFile: join(dir, "processed.json"),
      positionsFile: join(dir, "positions.json"),
      pollIntervalMs: 1000,
    }, noopLogger);

    await watcher["pollOnce"]();
    expect(events).toHaveLength(0);

    source.setPositions([{ task: task("c1"), list: "This Week" }]);
    await watcher["pollOnce"]();

    const moved = events.find((e) => e.type === "task.moved");
    expect(moved).toBeDefined();
    if (moved?.type === "task.moved") {
      expect(moved.fromList).toBe("Backlog");
      expect(moved.toList).toBe("This Week");
      expect(moved.task.meta).toEqual({ move: { fromList: "Backlog", toList: "This Week" } });
      expect(events).toHaveLength(1);
    }
    off();
    await rm(dir, { recursive: true, force: true });
  });

  test("карточка, ушедшая в Done, не даёт ложного move", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tw-"));
    const bus = new InMemoryEventBus();
    const events: WorkflowEvent[] = [];
    const off = bus.subscribe((e) => events.push(e));
    const source = makePositionedSource([{ task: task("c2"), list: "Backlog" }], []);
    const watcher = new TaskWatcher(source, bus, {
      processedFile: join(dir, "processed.json"),
      positionsFile: join(dir, "positions.json"),
      pollIntervalMs: 1000,
    }, noopLogger);

    await watcher["pollOnce"]();
    source.setPositions([]); // ack унёс карточку в Done → нет в открытых листах
    await watcher["pollOnce"]();

    expect(events.filter((e) => e.type === "task.moved")).toHaveLength(0);
    off();
    await rm(dir, { recursive: true, force: true });
  });
});

describe("isPositioned", () => {
  test("опознаёт IPositionedTaskSource по fetchPositions", () => {
    const plain: ITaskSource = { id: "file", fetchNewTasks: async () => [], ackTask: async () => {} };
    expect(isPositioned(plain)).toBe(false);
    expect(isPositioned(makePositionedSource([], []))).toBe(true);
  });
});