import { createHmac, timingSafeEqual } from "node:crypto";
import type { Server } from "bun";
import type { IAgentExecutor, IWebhookBinding, IWebhookProvider, IWebhookStore, IWorkflowTask } from "@opencode-workflow/sdk";
import type { IEventBus, IEventHistory, WorkflowEvent } from "../core/events.ts";
import type { IPipelineStateStore } from "../core/pipeline.ts";
import type { ModuleAction, ModuleDomain } from "../core/types.ts";
import type { IWorkflowRegistry } from "../core/workflows.ts";
import type { WorkflowDirLoader } from "../impl/WorkflowDirLoader.ts";
import { withMove } from "../impl/TaskWatcher.ts";
import { WORKFLOW_PROMPT } from "../impl/OpencodeAgentExecutor.ts";
import { slugify } from "../impl/slug.ts";

const KNOWN_ACTIONS: readonly ModuleAction[] = ["add", "update", "delete", "decompose"];
const KNOWN_DOMAINS: readonly ModuleDomain[] = ["nestjs", "dotnet", "frontend", "general"];

/** SSE keep-alive пинг, чтобы прокси/браузеры не рвали длинное соединение. */
const SSE_PING_MS = 15000;

/** Верхняя граница множества отработанных delivery id (защита от необъятного роста). */
const DELIVERY_DEDUP_LIMIT = 500;

/** Человеко-удобный id биндинга вебхука без внешних зависимостей. */
function randomHookId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export interface HttpApiWebhooks {
  store: IWebhookStore;
  providers: ReadonlyMap<string, IWebhookProvider>;
}

/** HTTP-слой платформы: /health, /agents, /run, /task, /workflow(s), /hooks, /stream. */
export class HttpApiController {
  private server?: Server<undefined>;
  private readonly seenDeliveries = new Set<string>();
  private readonly deliveryOrder: string[] = [];

  constructor(
    private readonly executor: IAgentExecutor,
    private readonly bus: IEventBus & IEventHistory,
    private readonly port: number = Number(process.env.PORT ?? 8787),
    private readonly store?: IPipelineStateStore,
    private readonly webhooks?: HttpApiWebhooks,
    private readonly workflows?: IWorkflowRegistry,
    private readonly loader?: WorkflowDirLoader
  ) {}

  start(): void {
    this.server = Bun.serve({
      port: this.port,
      idleTimeout: 255,
      fetch: (req, server) => this.fetch(req, server),
    });
    console.log(`webhook listening on http://localhost:${this.server.port}/stream`);
  }

  get boundPort(): number {
    return this.server?.port ?? this.port;
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

  private async fetch(req: Request, server: Server<undefined>): Promise<Response> {
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

    if (url.pathname === "/workflows" && req.method === "GET") {
      return this.handleWorkflowsList();
    }

    const workflowStart = /^\/workflow\/([^/]+)$/.exec(url.pathname);
    if (workflowStart && workflowStart[1] && req.method === "POST") {
      return this.handleWorkflowStart(workflowStart[1], req);
    }

    const workflowStop = /^\/workflow\/([^/]+)\/([^/]+)\/stop$/.exec(url.pathname);
    if (workflowStop && workflowStop[1] && workflowStop[2] && req.method === "POST") {
      return this.handleWorkflowStop(workflowStop[1], workflowStop[2]);
    }

    const workflowStatus = /^\/workflow\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (workflowStatus && workflowStatus[1] && workflowStatus[2] && req.method === "GET") {
      return this.handleWorkflowStatus(workflowStatus[2]);
    }

    if (url.pathname === "/internal/workflows/reload" && req.method === "POST") {
      return this.handleWorkflowReload(req, server);
    }

    if (url.pathname === "/hooks" && req.method === "GET") {
      return this.handleHooksList();
    }

    if (url.pathname === "/hooks" && req.method === "POST") {
      return this.handleHooksCreate(req);
    }

    const hookDelete = /^\/hooks\/([^/]+)$/.exec(url.pathname);
    if (hookDelete && hookDelete[1] && req.method === "DELETE") {
      return this.handleHooksRemove(hookDelete[1]);
    }

    const hookIngest = /^\/hooks\/([^/]+)$/.exec(url.pathname);
    if (hookIngest && hookIngest[1] && req.method === "HEAD") {
      return Response.json(null, { status: 200 });
    }
    if (hookIngest && hookIngest[1] && req.method === "POST") {
      return this.handleHookIngest(hookIngest[1], req);
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

  /** Список зарегистрированных workflow: id/label/phases для дашборда и хуков. */
  private async handleWorkflowsList(): Promise<Response> {
    const workflows = (this.workflows?.list() ?? []).map((handle) => ({
      id: handle.id,
      label: handle.label,
      phases: handle.phases,
    }));
    return Response.json({ ok: true, workflows });
  }

  private async handleWorkflowStart(id: string, req: Request): Promise<Response> {
    const handle = this.workflows?.resolve(id);
    if (!handle) {
      return Response.json({ ok: false, error: `unknown workflow "${id}"` }, { status: 404 });
    }
    try {
      const body = (await req.json()) as { title?: unknown; meta?: Readonly<Record<string, unknown>> };
      const title = typeof body?.title === "string" ? body.title.trim() : "";
      if (!title) {
        return Response.json({ ok: false, error: `workflow "${id}" требует title` }, { status: 400 });
      }
      const task: IWorkflowTask = {
        externalId: slugify(title),
        source: "cli",
        title,
        createdAt: new Date().toISOString(),
        ...(body.meta && typeof body.meta === "object" ? { meta: body.meta } : {}),
      };
      const runId = await handle.start(task);
      if (!runId) {
        return Response.json({ ok: false, workflow: handle.id, received: false });
      }
      return Response.json({ ok: true, workflow: handle.id, runId }, { status: 202 });
    } catch (err) {
      return Response.json({ ok: false, error: String(err) }, { status: 400 });
    }
  }

  private async handleWorkflowStatus(runId: string): Promise<Response> {
    if (!this.store) {
      return Response.json({ ok: false, error: "store not configured" }, { status: 501 });
    }
    const state = await this.store.load(runId);
    if (!state) {
      return Response.json({ ok: false, error: `no run ${runId}` }, { status: 404 });
    }
    return Response.json({ ok: true, state });
  }

  /**
   * Остановка активного рана: 404 — ран неизвестен, 409 — ран уже
   * в терминальном состоянии, 200 — сигнал остановки доставлен.
   */
  private async handleWorkflowStop(id: string, runId: string): Promise<Response> {
    const handle = this.workflows?.resolve(id);
    if (!handle) {
      return Response.json({ ok: false, error: `unknown workflow "${id}"` }, { status: 404 });
    }
    if (!this.store) {
      return Response.json({ ok: false, error: "store not configured" }, { status: 501 });
    }
    const state = await this.store.load(runId);
    if (!state) {
      return Response.json({ ok: false, error: `no run ${runId}` }, { status: 404 });
    }
    if (!handle.stop(runId)) {
      return Response.json({ ok: false, error: `run ${runId} is not active`, state }, { status: 409 });
    }
    return Response.json({ ok: true, runId, stopped: true });
  }

  /**
   * Hot-reload каталога workflows из watcher-процесса: пересканирование,
   * дифф и диспатч workflow.registered/updated/removed. Только loopback
   * либо токен RELOAD_TOKEN.
   */
  private async handleWorkflowReload(req: Request, server: Server<undefined>): Promise<Response> {
    if (!this.loader) {
      return Response.json({ ok: false, error: "workflow dir not configured" }, { status: 501 });
    }
    const token = process.env.RELOAD_TOKEN;
    if (token) {
      if (req.headers.get("x-reload-token") !== token) {
        return Response.json({ ok: false, error: "bad token" }, { status: 401 });
      }
    } else {
      const address = server.requestIP(req)?.address;
      const loopback =
        address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
      if (!loopback) {
        return Response.json({ ok: false, error: "forbidden" }, { status: 401 });
      }
    }
    try {
      await this.loader.sync();
      return Response.json({ ok: true, reindexed: true });
    } catch (err) {
      return Response.json({ ok: false, error: String(err) }, { status: 500 });
    }
  }

  private async handleHooksList(): Promise<Response> {
    if (!this.webhooks) {
      return Response.json({ ok: false, error: "webhooks not configured" }, { status: 501 });
    }
    const bindings = await this.webhooks.store.list();
    return Response.json({ ok: true, hooks: bindings });
  }

  private async handleHooksCreate(req: Request): Promise<Response> {
    if (!this.webhooks) {
      return Response.json({ ok: false, error: "webhooks not configured" }, { status: 501 });
    }
    try {
      const body = (await req.json()) as {
        source?: unknown;
        provider?: unknown;
        workflow?: unknown;
        action?: unknown;
        domain?: unknown;
        secretEnv?: unknown;
        enabled?: unknown;
      };
      const source = typeof body?.source === "string" ? body.source.trim() : "";
      const provider = body?.provider;
      if (!source) {
        return Response.json({ ok: false, error: "hook требует source" }, { status: 400 });
      }
      if (provider !== "github" && provider !== "generic" && provider !== "trello") {
        return Response.json({ ok: false, error: 'provider должен быть "github" | "generic" | "trello"' }, { status: 400 });
      }
      const workflow = typeof body.workflow === "string" ? body.workflow.trim() : undefined;
      if (workflow && !this.workflows?.resolve(workflow)) {
        return Response.json({ ok: false, error: `unknown workflow "${workflow}"` }, { status: 400 });
      }
      const action = body.action as ModuleAction | undefined;
      if (action && !KNOWN_ACTIONS.includes(action)) {
        return Response.json({ ok: false, error: `unknown action "${action}"` }, { status: 400 });
      }
      const domain = body.domain as ModuleDomain | undefined;
      if (domain && !KNOWN_DOMAINS.includes(domain)) {
        return Response.json({ ok: false, error: `unknown domain "${domain}"` }, { status: 400 });
      }
      const binding: IWebhookBinding = {
        id: `hk_${randomHookId()}`,
        source,
        provider,
        ...(workflow ? { workflow } : {}),
        ...(action ? { action } : {}),
        ...(domain ? { domain } : {}),
        ...(typeof body.secretEnv === "string" && body.secretEnv ? { secretEnv: body.secretEnv } : {}),
        enabled: body.enabled !== false,
        createdAt: new Date().toISOString(),
      };
      await this.webhooks.store.save(binding);
      return Response.json({ ok: true, id: binding.id, url: `/hooks/${binding.id}` }, { status: 201 });
    } catch (err) {
      return Response.json({ ok: false, error: String(err) }, { status: 400 });
    }
  }

  private async handleHooksRemove(id: string): Promise<Response> {
    if (!this.webhooks) {
      return Response.json({ ok: false, error: "webhooks not configured" }, { status: 501 });
    }
    const binding = await this.webhooks.store.load(id);
    if (!binding) {
      return Response.json({ ok: false, error: `no hook ${id}` }, { status: 404 });
    }
    await this.webhooks.store.remove(id);
    return Response.json({ ok: true, removed: id });
  }

  /**
   * Ingress вебхука: проверка секрета (HMAC по сырому телу), дедуп delivery,
   * резолв workflow (binding.workflow || module) и асинхронный запуск через
   * IWorkflowHandle. Ничего не замалчиваем: каждая причина отказа
   * публикуется в шину как entrypoint.ignored.
   */
  private async handleHookIngest(id: string, req: Request): Promise<Response> {
    if (!this.webhooks) {
      return Response.json({ ok: false, error: "webhooks not configured" }, { status: 501 });
    }
    const binding = await this.webhooks.store.load(id);
    if (!binding) {
      this.bus.publish({ type: "entrypoint.ignored", hookId: id, reason: "unknown_binding" });
      return Response.json({ ok: false, error: `no hook ${id}` }, { status: 404 });
    }
    if (!binding.enabled) {
      this.bus.publish({ type: "entrypoint.ignored", hookId: id, reason: "binding_disabled" });
      return Response.json({ ok: false, error: "hook disabled" }, { status: 404 });
    }

    const raw = await req.text();
    const signature = req.headers.get("x-hub-signature-256");
    if (binding.secretEnv) {
      const secret = process.env[binding.secretEnv];
      if (!secret) {
        this.bus.publish({
          type: "entrypoint.ignored",
          hookId: id,
          reason: "misconfigured",
          detail: `secretEnv "${binding.secretEnv}" не в env`,
        });
        return Response.json({ ok: false, error: "webhook misconfigured" }, { status: 500 });
      }
      if (!(await this.verifyHmac(raw, signature, secret))) {
        this.bus.publish({ type: "entrypoint.ignored", hookId: id, reason: "bad_signature" });
        return Response.json({ ok: false, error: "bad signature" }, { status: 401 });
      }
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      this.bus.publish({ type: "entrypoint.ignored", hookId: id, reason: "misconfigured", detail: "body не JSON" });
      return Response.json({ ok: false, error: "body не JSON" }, { status: 400 });
    }

    const eventHeaders = Object.fromEntries(req.headers.entries());
    const bodyDelivery = (payload as { delivery_id?: unknown })?.delivery_id;
    const deliveryId =
      typeof bodyDelivery === "string"
        ? bodyDelivery
        : (eventHeaders["x-github-delivery"] as string | undefined);
    if (deliveryId && this.seenDeliveries.has(deliveryId)) {
      this.bus.publish({ type: "entrypoint.ignored", hookId: id, reason: "duplicate_delivery" });
      return Response.json({ ok: true, received: false, duplicate: true });
    }
    if (deliveryId) {
      this.seenDeliveries.add(deliveryId);
      this.deliveryOrder.push(deliveryId);
      while (this.deliveryOrder.length > DELIVERY_DEDUP_LIMIT) {
        const evicted = this.deliveryOrder.shift();
        if (evicted) this.seenDeliveries.delete(evicted);
      }
    }

    const provider = this.webhooks.providers.get(binding.provider);
    if (!provider) {
      this.bus.publish({
        type: "entrypoint.ignored",
        hookId: id,
        reason: "misconfigured",
        detail: `no provider "${binding.provider}"`,
      });
      return Response.json({ ok: false, error: "webhook misconfigured" }, { status: 500 });
    }
    const filtered = provider.toTask(binding, payload, eventHeaders);
    if (!filtered.accepted) {
      this.bus.publish({ type: "entrypoint.ignored", hookId: id, reason: "filter_mismatch", detail: filtered.reason });
      return Response.json({ ok: true, received: false, started: false });
    }

    // Trello: события публикуются в шину — реакторы (task.received/task.moved)
    // и модульный матчер работают так же, как при поллинге Trello-источника.
    if (filtered.kind === "moved") {
      const fromList = filtered.fromList ?? "";
      const toList = filtered.toList ?? "";
      this.bus.publish({ type: "task.moved", task: withMove(filtered.task, fromList, toList), fromList, toList });
      return Response.json({ ok: true, received: true, started: false, event: "task.moved" });
    }
    if (binding.provider === "trello") {
      this.bus.publish({ type: "task.received", task: filtered.task });
      return Response.json({ ok: true, received: true, started: false, event: "task.received" });
    }

    const handle = this.workflows?.resolve(binding.workflow ?? "module");
    if (!handle) {
      this.bus.publish({
        type: "entrypoint.ignored",
        hookId: id,
        reason: "misconfigured",
        detail: `unknown workflow "${binding.workflow ?? "module"}"`,
      });
      return Response.json({ ok: false, error: "workflow not configured" }, { status: 500 });
    }
    const runId = await handle.start(filtered.task);
    return Response.json({ ok: true, received: true, started: runId !== null, runId: runId ?? undefined });
  }

  private async verifyHmac(rawBody: string, signature: string | null, secret: string): Promise<boolean> {
    if (!signature) return false;
    const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
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