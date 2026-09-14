import { createHmac, timingSafeEqual } from "node:crypto";
import type { Server } from "bun";
import type { IAgentExecutor } from "../core/executor.ts";
import type { IEventBus, IEventHistory, WorkflowEvent } from "../core/events.ts";
import type { IWorkflowTask } from "../core/task.ts";
import type { IPipelineStateStore } from "../core/pipeline.ts";
import type { INodeRunner } from "../core/node.ts";
import type { IWebhookBinding, IWebhookProvider, IWebhookStore, IWorkflowStarter } from "../core/webhook.ts";
import type { IPipelineData } from "../core/pipeline-data.ts";
import type { ModuleAction, ModuleDomain } from "../core/types.ts";
import { WORKFLOW_PROMPT } from "../impl/OpencodeAgentExecutor.ts";
import { detectAction, detectDomain } from "../impl/ModuleMatcher.ts";
import { slugify } from "../impl/slug.ts";
import { DepthFirstNodeRunner } from "../impl/DepthFirstNodeRunner.ts";
import { WebhookEntrypointNode } from "../impl/WebhookEntrypointNode.ts";
import type { ModulePipeline } from "../impl/ModulePipeline.ts";

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
  starter: IWorkflowStarter<IPipelineData>;
}

/** HTTP-слой платформы: /health, /agents, /run, /task, /module, /stream, /hooks. */
export class HttpApiController {
  private server?: Server<undefined>;
  private readonly runner: INodeRunner = new DepthFirstNodeRunner();
  private readonly hookNodes = new Map<string, WebhookEntrypointNode<IPipelineData>>();
  private readonly seenDeliveries = new Set<string>();
  private readonly deliveryOrder: string[] = [];

  constructor(
    private readonly executor: IAgentExecutor,
    private readonly bus: IEventBus & IEventHistory,
    private readonly port: number = Number(process.env.PORT ?? 8787),
    private readonly pipeline?: ModulePipeline,
    private readonly store?: IPipelineStateStore,
    private readonly webhooks?: HttpApiWebhooks
  ) {}

  start(): void {
    this.server = Bun.serve({
      port: this.port,
      idleTimeout: 255,
      fetch: (req) => this.fetch(req),
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

    const moduleStop = /^\/module\/([^/]+)\/stop$/.exec(url.pathname);
    if (moduleStop && moduleStop[1] && req.method === "POST") {
      return this.handleModuleStop(moduleStop[1]);
    }

    const moduleStatus = /^\/module\/([^/]+)$/.exec(url.pathname);
    if (moduleStatus && moduleStatus[1] && req.method === "GET") {
      return this.handleModuleStatus(moduleStatus[1]);
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

  /**
   * Остановка активного рана: 404 — ран неизвестен, 409 — ран уже
   * в терминальном состоянии, 200 — сигнал остановки доставлен
   * (финал cancelled придёт событием pipeline.cancelled).
   */
  private async handleModuleStop(runId: string): Promise<Response> {
    if (!this.pipeline) {
      return Response.json({ ok: false, error: "pipeline not configured" }, { status: 501 });
    }
    if (!this.store) {
      return Response.json({ ok: false, error: "store not configured" }, { status: 501 });
    }
    const state = await this.store.load(runId);
    if (!state) {
      return Response.json({ ok: false, error: `no run ${runId}` }, { status: 404 });
    }
    if (!this.pipeline.stop(runId)) {
      return Response.json({ ok: false, error: `run ${runId} is not active`, state }, { status: 409 });
    }
    return Response.json({ ok: true, runId, stopped: true });
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
      if (provider !== "github" && provider !== "generic") {
        return Response.json({ ok: false, error: 'provider должен быть "github" | "generic"' }, { status: 400 });
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
        ...(action ? { action } : {}),
        ...(domain ? { domain } : {}),
        ...(typeof body.secretEnv === "string" && body.secretEnv ? { secretEnv: body.secretEnv } : {}),
        enabled: body.enabled !== false,
        createdAt: new Date().toISOString(),
      };
      await this.webhooks.store.save(binding);
      this.hookNodes.delete(binding.id);
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
    this.hookNodes.delete(id);
    return Response.json({ ok: true, removed: id });
  }

  /**
   * Ingress вебхука: проверка секрета (HMAC по сырому телу), дедуп delivery,
   * запуск workflow через entrypoint-ноду. Ничего не замалчиваем: каждая
   * причина отказа публикуется в шину как entrypoint.ignored.
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

    const node = await this.entrypointFor(binding);
    const result = await this.runner.trigger(node, { payload, headers: eventHeaders, deliveryId }, { maxVisits: 1000 });
    return Response.json({ ok: true, received: true, started: result.started });
  }

  private async entrypointFor(binding: IWebhookBinding): Promise<WebhookEntrypointNode<IPipelineData>> {
    const cached = this.hookNodes.get(binding.id);
    if (cached) return cached;
    const node = new WebhookEntrypointNode(
      `hook:${binding.id}`,
      binding,
      this.webhooks?.providers ?? new Map(),
      this.webhooks?.starter as IWorkflowStarter<IPipelineData>,
      this.bus
    );
    this.hookNodes.set(binding.id, node);
    return node;
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