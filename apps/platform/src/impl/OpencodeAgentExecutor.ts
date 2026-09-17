import { createOpencodeClient } from "@opencode-ai/sdk";
import type { OpencodeClient } from "@opencode-ai/sdk";
import type { IAgentExecutor, PromptSessionResult, SessionSummary } from "@opencode-workflow/sdk";
import {
  OpencodeConnectionError,
  OpencodeSessionCreateError,
  OpencodeSessionPromptError,
} from "@opencode-workflow/sdk";

export const WORKFLOW_PROMPT = "Test";
export const WORKFLOW_TITLE = "Test workflow";

export function serverAuthHeaders(): Record<string, string> | undefined {
  const password = process.env.OPENCODE_SERVER_PASSWORD;
  if (!password) return undefined;
  const username = process.env.OPENCODE_SERVER_USERNAME ?? "opencode";
  const token = Buffer.from(`${username}:${password}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

/** Исполнитель агентов: только attach к существующему серверу.
 * Нет соединения — OpencodeConnectionError (UNIX: сервер сами не поднимаем,
 * для демо он живёт отдельным pm2-app `opencode`).
 * Один сервер обслуживает много проектов: клиент кэшируется per-directory,
 * платформа передаёт только пути-строки (файлы ей не нужны). */
export class OpencodeAgentExecutor implements IAgentExecutor {
  readonly id = "opencode";

  private readonly clients = new Map<string, OpencodeClient>();

  private constructor(
    private readonly serverUrl: string,
    private readonly headers: Record<string, string> | undefined,
    private readonly eventsAbort: AbortController
  ) {}

  static async create(): Promise<OpencodeAgentExecutor> {
    const serverUrl = process.env.OPENCODE_SERVER_URL ?? "";
    if (!serverUrl) throw new OpencodeConnectionError("");
    const headers = serverAuthHeaders();
    const probe = createOpencodeClient({ baseUrl: serverUrl, ...(headers ? { headers } : {}) });
    try {
      const res = await probe.app.agents();
      if (res.error) {
        throw new Error(`server check failed, HTTP ${res.response?.status}`);
      }
    } catch (err) {
      if (err instanceof OpencodeConnectionError) throw err;
      throw new OpencodeConnectionError(serverUrl, err);
    }

    const eventsAbort = new AbortController();
    const self = new OpencodeAgentExecutor(serverUrl, headers, eventsAbort);
    const client = self.clientFor();
    const eventsLoop = (async () => {
      try {
        const { stream } = await client.global.event({ signal: eventsAbort.signal });
        for await (const evt of stream) {
          try {
            const payload = evt?.payload;
            if (payload?.type === "permission.updated") {
              const p = payload.properties;
              if (p?.sessionID && p?.id) {
                await client.postSessionIdPermissionsPermissionId({
                  path: { id: p.sessionID, permissionID: p.id },
                  body: { response: "always" },
                });
              }
            }
          } catch {}
          if (eventsAbort.signal.aborted) break;
        }
      } catch {}
    })();
    eventsLoop.catch(() => {});

    return self;
  }

  /** Клиент сервера; directory сужает его до проекта (кэш per-directory). */
  private clientFor(directory?: string): OpencodeClient {
    const key = directory ?? process.env.OPENCODE_DIRECTORY ?? "";
    const hit = this.clients.get(key);
    if (hit) return hit;
    const client = createOpencodeClient({
      baseUrl: this.serverUrl,
      ...(this.headers ? { headers: this.headers } : {}),
      ...(key ? { directory: key } : {}),
    });
    this.clients.set(key, client);
    return client;
  }

  async listAgents(): Promise<string[]> {
    const res = await this.clientFor().app.agents();
    return (res.data ?? []).map((a) => a.name);
  }

  async createSession(title?: string, directory?: string): Promise<string> {
    const session = await this.clientFor(directory).session.create({
      body: { title: title ?? WORKFLOW_TITLE },
    });
    const sessionId = session.data?.id;
    if (!sessionId) throw new OpencodeSessionCreateError(title ?? WORKFLOW_TITLE);
    return sessionId;
  }

  async listSessions(opts: { directory?: string; limit?: number } = {}): Promise<SessionSummary[]> {
    const res = await this.clientFor(opts.directory).session.list();
    if (res.error) {
      throw new OpencodeConnectionError(this.serverUrl, `session list: HTTP ${res.response?.status}`);
    }
    const all = (res.data ?? []).map((s) => ({
      sessionId: s.id,
      title: s.title ?? "",
      directory: (s as { directory?: string }).directory ?? "",
      updatedAt: new Date(
        ((s as { time?: { updated?: number; created?: number } }).time?.updated ??
          (s as { time?: { created?: number } }).time?.created ??
          0)
      ).toISOString(),
    }));
    const mine = opts.directory ? all.filter((s) => s.directory === opts.directory) : all;
    mine.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return opts.limit !== undefined ? mine.slice(0, opts.limit) : mine;
  }

  async runSession(opts: {
    prompt: string;
    agent?: string;
    sessionTitle?: string;
    sessionId?: string;
    directory?: string;
    signal?: AbortSignal;
  }): Promise<PromptSessionResult> {
    if (opts.signal?.aborted) throw new Error("run stopped");
    const client = this.clientFor(opts.directory);
    let sessionId = opts.sessionId;
    if (!sessionId) {
      try {
        sessionId = await this.createSession(opts.sessionTitle, opts.directory);
      } catch (err) {
        if (err instanceof OpencodeSessionCreateError) throw err;
        throw new OpencodeSessionCreateError(opts.sessionTitle ?? WORKFLOW_TITLE, err);
      }
    }

    try {
      await client.session.promptAsync({
        path: { id: sessionId },
        body: {
          ...(opts.agent ? { agent: opts.agent } : {}),
          parts: [{ type: "text", text: opts.prompt }],
        },
      });
    } catch (err) {
      throw new OpencodeSessionPromptError(sessionId, "промпт не принят сервером", err);
    }

    try {
      const text = await this.waitForCompletion(client, sessionId, opts.signal);
      return { sessionId, text };
    } catch (err) {
      throw new OpencodeSessionPromptError(sessionId, "ответ не дождались", err);
    }
  }

  /**
   * Ожидание завершения turn'а поллингом: закрываемся по completed-флагу
   * последнего сообщения либо по стабильности текста (fallback для провайдеров,
   * не отдающих step-finish / completed). Аборт сигнала — немедленный выход.
   */
  private async waitForCompletion(client: OpencodeClient, sessionId: string, signal?: AbortSignal): Promise<string> {
    const timeoutMs = Number(process.env.PHASE_TIMEOUT_MS ?? 20 * 60 * 1000);
    const settleMs = Number(process.env.PHASE_SETTLE_MS ?? 60 * 1000);
    const started = Date.now();
    let lastSignature = "";

    while (Date.now() - started < timeoutMs) {
      if (signal?.aborted) throw new Error("run stopped");
      const res = await client.session.messages({ path: { id: sessionId } });
      const messages = res.data ?? [];
      let tailText = "";
      let tailCreated = 0;
      let tailCompleted = false;
      for (const m of messages) {
        const info = m.info as { role?: string; time?: { created?: number; completed?: number } } | undefined;
        if (info?.role !== "assistant") continue;
        const text = (m.parts ?? [])
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("");
        if (!text) continue;
        tailText = text;
        tailCreated = info.time?.created ?? tailCreated;
        tailCompleted = Boolean(info.time?.completed);
      }
      if (tailText) {
        const signature = `${tailCompleted}:${tailText.length}:${tailCreated}`;
        if (tailCompleted) return tailText;
        if (signature === lastSignature && Date.now() - tailCreated >= settleMs) {
          return tailText;
        }
        lastSignature = signature;
      }
      await this.abortableSleep(2000, signal);
    }
    throw new Error(`phase timed out after ${Math.round((Date.now() - started) / 1000)}s (session ${sessionId})`);
  }

  /** Пауза поллинга, прерываемая stop-сигналом пайплайна. */
  private abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new Error("run stopped"));
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new Error("run stopped"));
        },
        { once: true }
      );
    });
  }

  async close(): Promise<void> {
    this.eventsAbort.abort();
  }
}