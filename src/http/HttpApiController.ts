import type { Server } from "bun";
import type { IAgentExecutor } from "../core/executor.ts";
import type { IEventBus, IEventHistory, WorkflowEvent } from "../core/events.ts";
import type { IWorkflowTask } from "../core/task.ts";
import type { IPipelineStateStore } from "../core/pipeline.ts";
import type { ModuleAction, ModuleDomain } from "../core/types.ts";
import { WORKFLOW_PROMPT } from "../impl/OpencodeAgentExecutor.ts";
import { detectAction, detectDomain } from "../impl/ModuleMatcher.ts";
import { slugify } from "../impl/slug.ts";
import type { ModulePipeline } from "../impl/ModulePipeline.ts";

const KNOWN_ACTIONS: readonly ModuleAction[] = ["add", "update", "delete", "decompose"];
const KNOWN_DOMAINS: readonly ModuleDomain[] = ["nestjs", "dotnet", "frontend", "general"];

/** SSE keep-alive пинг, чтобы прокси/браузеры не рвали длинное соединение. */
const SSE_PING_MS = 15000;

/** HTTP-слой платформы: /health, /agents, /run, /task, /module, /stream поверх шины событий. */
export class HttpApiController {
  private server?: Server<undefined>;

  constructor(
    private readonly executor: IAgentExecutor,
    private readonly bus: IEventBus & IEventHistory,
    private readonly port: number = Number(process.env.PORT ?? 8787),
    private readonly pipeline?: ModulePipeline,
    private readonly store?: IPipelineStateStore
  ) {}

  start(): void {
    this.server = Bun.serve({
      port: this.port,
      idleTimeout: 255,
      fetch: (req) => this.fetch(req),
    });
    console.log(`webhook listening on http://localhost:${this.server.port}/stream`);
  }

  stop(): void {
    this.server?.stop();
  }

  /**
   * SSE-стрим событий платформы: сначала snapshot истории, затем живые события.
   * Имя SSE-события = тип WorkflowEvent, data = JSON события + ts (порядковый).
   */
  private handleStream(): Response {
    const enc = new TextEncoder();
    let closed = false;
    let unsubscribe: (() => void) | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;

    const close = (): void => {
      if (closed) return;
      closed = true;
      unsubscribe?.();
      if (ping) clearInterval(ping);
    };

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const send = (event: WorkflowEvent): void => {
          if (closed) return;
          const frame = `event: ${event.type}\ndata: ${JSON.stringify({ ...event, ts: Date.now() })}\n\n`;
          try {
            controller.enqueue(enc.encode(frame));
          } catch {
            close();
          }
        };

        // подписка раньше snapshot: событие не теряется (допустим редкий дубликат,
        // фронтовый редьюсер идемпотентен по содержимому)
        unsubscribe = this.bus.subscribe(send);
        controller.enqueue(
          enc.encode(`event: snapshot\ndata: ${JSON.stringify({ events: this.bus.history(), ts: Date.now() })}\n\n`)
        );
        ping = setInterval(() => {
          if (closed) return;
          try {
            controller.enqueue(enc.encode(": ping\n\n"));
          } catch {
            close();
          }
        }, SSE_PING_MS);
      },
      cancel: close,
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "connection": "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  }

  private async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health" && req.method === "GET") {
      return Response.json({ ok: true });
    }

    if (url.pathname === "/agents" && req.method === "GET") {
      try {
        return Response.json({ ok: true, agents: await this.executor.listAgents() });
      } catch (err) {
        return Response.json({ ok: false, error: String(err) }, { status: 500 });
      }
    }

    if (url.pathname === "/run" && (req.method === "POST" || req.method === "GET")) {
      return this.handleRun(await this.readAgent(req, url));
    }

    if (url.pathname === "/task" && req.method === "POST") {
      return this.handleTaskIngest(req);
    }

    if (url.pathname === "/stream" && req.method === "GET") {
      return this.handleStream();
    }

    if (url.pathname === "/module" && req.method === "POST") {
      return this.handleModuleStart(req);
    }

    }

    const moduleStatus = /^\/module\/([^/]+)$/.exec(url.pathname);
    if (moduleStatus && moduleStatus[1] && req.method === "GET") {
      return this.handleModuleStatus(moduleStatus[1]);
    }

    return Response.json({ ok: false, error: "not found" }, { status: 404 });
  }

  private async handleTaskIngest(req: Request): Promise<Response> {
    try {
      const body = (await req.json()) as IWorkflowTask;
      if (!body.externalId || !body.title) {
        return Response.json(
          { ok: false, error: "task требует externalId и title" },
          { status: 400 }
        );
      }
      this.bus.publish({ type: "task.received", task: body });
      return Response.json({ ok: true, received: body.externalId });
    } catch (err) {
      return Response.json({ ok: false, error: String(err) }, { status: 400 });
    }
  }

  private async handleModuleStart(req: Request): Promise<Response> {
    if (!this.pipeline) {
      return Response.json({ ok: false, error: "pipeline not configured" }, { status: 501 });
    }
    try {
      const body = (await req.json()) as { title?: unknown; domain?: unknown; action?: unknown };
      const title = typeof body?.title === "string" ? body.title.trim() : "";
      if (!title) {
        return Response.json({ ok: false, error: "module требует title" }, { status: 400 });
      }
      const domain = body.domain as ModuleDomain | undefined;
      const action = body.action as ModuleAction | undefined;
      if (domain && !KNOWN_DOMAINS.includes(domain)) {
        return Response.json({ ok: false, error: `unknown domain "${domain}"`, domains: KNOWN_DOMAINS }, { status: 400 });
      }
      if (action && !KNOWN_ACTIONS.includes(action)) {
        return Response.json({ ok: false, error: `unknown action "${action}"`, actions: KNOWN_ACTIONS }, { status: 400 });
      }
      const task: IWorkflowTask = {
        externalId: slugify(title),
        source: "cli",
        title,
        createdAt: new Date().toISOString(),
      };
      const resolvedDomain = domain ?? detectDomain(title);
      const resolvedAction = action ?? detectAction(title);
      const runId = `run-${task.source}-${task.externalId}`;
      void this.pipeline
        .start(task, resolvedDomain, resolvedAction)
        .catch((err) => console.error(`[module] ${runId}: ${String(err)}`));
      return Response.json({ ok: true, runId, domain: resolvedDomain, action: resolvedAction }, { status: 202 });
    } catch (err) {
      return Response.json({ ok: false, error: String(err) }, { status: 400 });
    }
  }

  private async handleModuleStatus(runId: string): Promise<Response> {
    if (!this.store) {
      return Response.json({ ok: false, error: "store not configured" }, { status: 501 });
    }
    const state = await this.store.load(runId);
    if (!state) {
      return Response.json({ ok: false, error: `no run ${runId}` }, { status: 404 });
    }
    return Response.json({ ok: true, state });
  }

  private async handleRun(agent?: string): Promise<Response> {
    if (agent) {
      const known = await this.executor.listAgents();
      if (!known.includes(agent)) {
        return Response.json(
          { ok: false, error: `unknown agent "${agent}"`, agents: known },
          { status: 400 }
        );
      }
    }
    const startedAt = Date.now();
    try {
      const { sessionId, text } = await this.executor.runSession({
        prompt: WORKFLOW_PROMPT,
        ...(agent ? { agent } : {}),
      });
      return Response.json({
        ok: true,
        prompt: WORKFLOW_PROMPT,
        agent: agent ?? "build",
        sessionId,
        response: text,
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      return Response.json(
        { ok: false, error: String(err) },
        { status: 500 }
      );
    }
  }

  private async readAgent(req: Request, url: URL): Promise<string | undefined> {
    const fromQuery = url.searchParams.get("agent");
    if (fromQuery) return fromQuery;
    if (req.method === "POST") {
      try {
        const body = (await req.json()) as { agent?: unknown };
        if (body?.agent) return String(body.agent);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}