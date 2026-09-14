import { describe, expect, test } from "bun:test";
import type { INodeContext, INodeSpec } from "../core/node.ts";
import { DepthFirstNodeRunner } from "./DepthFirstNodeRunner.ts";
import { MapNodeContext } from "./MapNodeContext.ts";
import { NodeGraphBuilder } from "./NodeGraphBuilder.ts";

interface Data {
  trace: string[];
  attempts: number;
}

const tracker = (id: string) => ({
  id,
  executor: {
    run: async (ctx: INodeContext<Data>) => {
      ctx.data.trace.push(id);
      return ctx;
    },
  },
});

const spec = (id: string, outgoing: string[] = []): INodeSpec<Data> => ({
  id,
  executor: tracker(id).executor,
  outgoing,
});

function nodeOf<T>(graph: { nodes: ReadonlyMap<string, import("../core/node.ts").INode<T>> }, id: string): import("../core/node.ts").INode<T> {
  const node = graph.nodes.get(id);
  if (!node) throw new Error(`node "${id}" not found`);
  return node;
}

describe("NodeGraphBuilder", () => {
  test("строит граф и выводит incoming как зеркало outgoing", () => {
    const builder = new NodeGraphBuilder();
    const graph = builder.build<Data>([
      spec("a", ["b"]),
      spec("b", ["c"]),
      spec("c"),
    ]);
    expect(graph.nodes.size).toBe(3);
    expect(nodeOf(graph, "b").incoming.map((n) => n.id)).toEqual(["a"]);
    expect(nodeOf(graph, "c").incoming.map((n) => n.id)).toEqual(["b"]);
    expect(nodeOf(graph, "a").incoming).toHaveLength(0);
  });

  test("отклоняет дубликаты id, неизвестные ребра и self-loop", () => {
    const builder = new NodeGraphBuilder();
    expect(() => builder.build([spec("a"), spec("a")])).toThrow();
    expect(() => builder.build([spec("a", ["unknown"])])).toThrow();
    expect(() => builder.build([spec("a", ["a"])])).toThrow();
  });

  test("двунаправленный цикл допустим", () => {
    const builder = new NodeGraphBuilder();
    const graph = builder.build<Data>([spec("a", ["b"]), spec("b", ["a"])]);
    expect(nodeOf(graph, "a").outgoing.map((n) => n.id)).toEqual(["b"]);
    expect(nodeOf(graph, "b").incoming.map((n) => n.id)).toEqual(["a"]);
  });
});

describe("DepthFirstNodeRunner", () => {
  test("обходит граф в глубину и уважает condition", async () => {
    const builder = new NodeGraphBuilder();
    const graph = builder.build<Data>([
      {
        id: "guard",
        executor: tracker("guard").executor,
        outgoing: ["retry", "done"],
        condition: (ctx) => ctx.data.attempts < 2,
      },
      {
        id: "retry",
        executor: {
          run: async (ctx: INodeContext<Data>) => {
            ctx.data.attempts += 1;
            return ctx;
          },
        },
        outgoing: ["guard"],
      },
      spec("done"),
    ]);
    const runner = new DepthFirstNodeRunner();
    const ctx = new MapNodeContext<Data>("run-test", new AbortController().signal, { trace: [], attempts: 0 });
    await runner.run(nodeOf<Data>(graph, "guard"), ctx);
    expect(ctx.data.attempts).toBe(2);
    expect(ctx.data.trace.filter((id) => id === "guard").length).toBeLessThanOrEqual(2);
  });

  test("бросает при превышении бюджета визитов", async () => {
    const builder = new NodeGraphBuilder();
    const graph = builder.build<Data>([spec("a", ["b"]), spec("b", ["a"])]);
    const runner = new DepthFirstNodeRunner();
    const ctx = new MapNodeContext<Data>("run-budget", new AbortController().signal, { trace: [], attempts: 0 });
    await expect(runner.run(nodeOf<Data>(graph, "a"), ctx, { maxVisits: 3 })).rejects.toThrow();
  });

  test("прерывается по сигналу", async () => {
    const builder = new NodeGraphBuilder();
    const abortableSleep = (ms: number, signal: AbortSignal): Promise<void> => {
      if (signal.aborted) return Promise.reject(new Error("run stopped"));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new Error("run stopped"));
          },
          { once: true }
        );
      });
    };
    const graph = builder.build<Data>([
      {
        id: "slow",
        executor: {
          run: async (ctx: INodeContext<Data>) => {
            await abortableSleep(500, ctx.signal);
            return ctx;
          },
        },
        outgoing: [],
      },
    ]);
    const controller = new AbortController();
    const runner = new DepthFirstNodeRunner();
    const ctx = new MapNodeContext<Data>("run-abort", controller.signal, { trace: [], attempts: 0 });
    const run = runner.run(nodeOf<Data>(graph, "slow"), ctx);
    controller.abort();
    await expect(run).rejects.toThrow();
  });
});