import { describe, expect, test } from "bun:test";
import type { IAgentExecutor, PromptSessionResult } from "@opencode-workflow/sdk";
import {
  OpencodeConnectionError,
  OpencodeError,
  OpencodeSessionPromptError,
  graph,
  opencodeCreateSession,
  opencodeSessionPrompt,
  projectMap,
} from "@opencode-workflow/sdk";
import type { ProjectData, SessionData } from "@opencode-workflow/sdk";
import { DepthFirstNodeRunner } from "../engine/DepthFirstNodeRunner.ts";
import { MapNodeContext } from "../engine/MapNodeContext.ts";
import { NodeGraphBuilder } from "../engine/NodeGraphBuilder.ts";

interface ChainData extends SessionData {
  calls: string[];
}

/** Фейковый сервер: сессии в памяти, каждый промпт дописывает turn. */
function fakeExecutor(log: string[]): IAgentExecutor {
  let n = 0;
  const transcripts = new Map<string, string[]>();
  return {
    listAgents: async () => ["build"],
    createSession: async (title?: string) => {
      n += 1;
      const id = `sess-${n}`;
      transcripts.set(id, [`(title: ${title ?? "session"})`]);
      log.push(`create:${id}`);
      return id;
    },
    runSession: async (opts: {
      prompt: string;
      agent?: string;
      sessionTitle?: string;
      sessionId?: string;
      signal?: AbortSignal;
    }): Promise<PromptSessionResult> => {
      if (!opts.sessionId) {
        const id = await (async () => {
          n += 1;
          const fresh = `sess-${n}`;
          transcripts.set(fresh, []);
          return fresh;
        })();
        transcripts.get(id)!.push(opts.prompt);
        log.push(`run(new):${id}`);
        return { sessionId: id, text: `answer-in-${id}` };
      }
      const turns = transcripts.get(opts.sessionId);
      if (!turns) throw new OpencodeSessionPromptError(opts.sessionId, "нет такой сессии");
      turns.push(opts.prompt);
      log.push(`run(continue):${opts.sessionId}#${turns.length}`);
      return { sessionId: opts.sessionId, text: `answer-${turns.length}-in-${opts.sessionId}` };
    },
    listSessions: async () => [],
    close: async () => {},
  };
}

const rtOf = (executor: IAgentExecutor) =>
  ({ executor }) as unknown as import("@opencode-workflow/sdk").IWorkflowRuntime;

interface MapData extends ProjectData {
  task: { externalId: string; source: string; title: string; labels?: string[]; createdAt: string };
}

function fakeCommands(map: Record<string, string>) {
  return {
    execute: async (command: { service: string; op: string; params: Record<string, unknown> }) => {
      if (command.service !== "projects" || command.op !== "get") {
        return { ok: false as const, error: "unknown" };
      }
      const directory = map[command.params.label as string];
      if (!directory) return { ok: false as const, error: "нет маппинга" };
      return { ok: true as const, data: { entry: { label: command.params.label, directory } } };
    },
  };
}

const rtMapOf = (executor: IAgentExecutor, map: Record<string, string>) =>
  ({ executor, commands: fakeCommands(map) }) as unknown as import("@opencode-workflow/sdk").IWorkflowRuntime;

describe("opencode session nodes", () => {
  test("цепочка create → prompt → prompt держит одну сессию, text обновляется", async () => {
    const log: string[] = [];
    const rt = rtOf(fakeExecutor(log));
    const spec = graph<ChainData>("create", [
      opencodeCreateSession<ChainData>(rt, "create", { outgoing: ["ask"] }),
      opencodeSessionPrompt<ChainData>(rt, "ask", {
        prompt: "первый вопрос",
        outgoing: ["ask2"],
      }),
      opencodeSessionPrompt<ChainData>(rt, "ask2", { prompt: "второй вопрос", outgoing: [] }),
    ]);
    const nodes = new NodeGraphBuilder().build(spec.specs).nodes;
    const ctx = new MapNodeContext<ChainData>("run-1", new AbortController().signal, { calls: [] });
    await new DepthFirstNodeRunner().run(nodes.get("create")!, ctx);
    expect(ctx.data.opencode?.sessionId).toBe("sess-1");
    expect(ctx.data.opencode?.text).toBe("answer-3-in-sess-1");
    expect(log).toEqual(["create:sess-1", "run(continue):sess-1#2", "run(continue):sess-1#3"]);
  });

  test("create идемпотентен при ревизите (сессия не пересоздаётся)", async () => {
    const log: string[] = [];
    const rt = rtOf(fakeExecutor(log));
    const create = opencodeCreateSession<ChainData>(rt, "create", { outgoing: [] });
    const ctx = new MapNodeContext<ChainData>("run-2", new AbortController().signal, { calls: [] });
    await create.executor.run(ctx);
    await create.executor.run(ctx);
    expect(log.filter((l) => l.startsWith("create:")).length).toBe(1);
    expect(ctx.data.opencode?.sessionId).toBe("sess-1");
  });

  test("prompt без сессии бросает OpencodeSessionPromptError (наследник OpencodeError)", async () => {
    const rt = rtOf(fakeExecutor([]));
    const spec = graph<ChainData>("ask", [
      opencodeSessionPrompt<ChainData>(rt, "ask", { prompt: "x", outgoing: [] }),
    ]);
    const nodes = new NodeGraphBuilder().build(spec.specs).nodes;
    const ctx = new MapNodeContext<ChainData>("run-3", new AbortController().signal, { calls: [] });
    const err = await new DepthFirstNodeRunner().run(nodes.get("ask")!, ctx).then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(OpencodeSessionPromptError);
    expect(err).toBeInstanceOf(OpencodeError);
    expect(String(err)).toContain("opencodeCreateSession");
  });

  test("обрыв соединения — OpencodeConnectionError в cause цепочки", async () => {
    const dead: IAgentExecutor = {
      listAgents: async () => {
        throw new OpencodeConnectionError("http://127.0.0.1:4096");
      },
      createSession: async () => {
        throw new OpencodeConnectionError("http://127.0.0.1:4096");
      },
      runSession: async () => {
        throw new OpencodeConnectionError("http://127.0.0.1:4096");
      },
      listSessions: async () => {
        throw new OpencodeConnectionError("http://127.0.0.1:4096");
      },
      close: async () => {},
    };
    const rt = rtOf(dead);
    const spec = graph<ChainData>("create", [opencodeCreateSession<ChainData>(rt, "create", { outgoing: [] })]);
    const nodes = new NodeGraphBuilder().build(spec.specs).nodes;
    const ctx = new MapNodeContext<ChainData>("run-4", new AbortController().signal, { calls: [] });
    const err = await new DepthFirstNodeRunner().run(nodes.get("create")!, ctx).then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(OpencodeError);
    const cause = (err as { cause?: unknown } | null)?.cause;
    expect(cause).toBeInstanceOf(OpencodeConnectionError);
  });
});

describe("projectMap datasource node", () => {
  const taskOf = (labels?: string[]): MapData["task"] => ({
    externalId: "c1",
    source: "trello",
    title: "t1",
    ...(labels ? { labels } : {}),
    createdAt: new Date().toISOString(),
  });

  test("матч по лейблу пишет project, downstream видит его", async () => {
    const rt = rtMapOf(fakeExecutor([]), { speka: "/work/speka" });
    const spec = graph<MapData>("map", [projectMap<MapData>(rt, "map", { outgoing: [] })]);
    const nodes = new NodeGraphBuilder().build(spec.specs).nodes;
    const ctx = new MapNodeContext<MapData>("run-m1", new AbortController().signal, { task: taskOf(["speka"]) });
    await new DepthFirstNodeRunner().run(nodes.get("map")!, ctx);
    expect(ctx.data.project).toEqual({ label: "speka", directory: "/work/speka" });
  });

  test("нет маппинга — тихий пропуск: project не пишется", async () => {
    const rt = rtMapOf(fakeExecutor([]), { speka: "/work/speka" });
    const spec = graph<MapData>("map", [projectMap<MapData>(rt, "map", { outgoing: [] })]);
    const nodes = new NodeGraphBuilder().build(spec.specs).nodes;
    const ctx = new MapNodeContext<MapData>("run-m2", new AbortController().signal, { task: taskOf(["other"]) });
    await new DepthFirstNodeRunner().run(nodes.get("map")!, ctx);
    expect(ctx.data.project).toBeUndefined();
  });

  test("condition-гейт отсекает поддерево без project", async () => {
    const visited: string[] = [];
    const rt = rtMapOf(fakeExecutor([]), { speka: "/work/speka" });
    const spec = graph<MapData>("map", [
      projectMap<MapData>(rt, "map", { outgoing: ["work"] }),
      {
        id: "work",
        executor: {
          run: async (ctx: import("@opencode-workflow/sdk").INodeContext<MapData>) => {
            visited.push("work");
            return ctx;
          },
        },
        outgoing: [],
        condition: (ctx: import("@opencode-workflow/sdk").INodeContext<MapData>) => Boolean(ctx.data.project),
      },
    ]);
    const nodes = new NodeGraphBuilder().build(spec.specs).nodes;
    const ctx = new MapNodeContext<MapData>("run-m3", new AbortController().signal, { task: taskOf(["other"]) });
    await new DepthFirstNodeRunner().run(nodes.get("map")!, ctx);
    expect(visited).toEqual([]);
  });
});

