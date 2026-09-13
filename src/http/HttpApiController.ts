import type { Server } from "bun";
import type { IAgentExecutor } from "../core/executor.ts";
import type { IEventBus } from "../core/events.ts";
import type { IWorkflowTask } from "../core/task.ts";
import { WORKFLOW_PROMPT } from "../impl/OpencodeAgentExecutor.ts";

/** HTTP-слой платформы: /health, /agents, /run, /task поверх IAgentExecutor + IEventBus. */
export class HttpApiController {
  private server?: Server<undefined>;

  constructor(
    private readonly executor: IAgentExecutor,
    private readonly bus: IEventBus,
    private readonly port: number = Number(process.env.PORT ?? 8787)
  ) {}

  start(): void {
    this.server = Bun.serve({
      port: this.port,
      idleTimeout: 255,
      fetch: (req) => this.fetch(req),
    });
    console.log(`webhook listening on http://localhost:${this.server.port}/run`);
  }

  stop(): void {
    this.server?.stop();
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