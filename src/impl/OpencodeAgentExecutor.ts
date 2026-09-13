import { createOpencodeClient, createOpencodeServer } from "@opencode-ai/sdk";
import type { OpencodeClient } from "@opencode-ai/sdk";
import type { IAgentExecutor } from "../core/executor.ts";
import type { PromptSessionResult } from "../core/types.ts";

export const WORKFLOW_PROMPT = "Test";
export const WORKFLOW_TITLE = "Test workflow";

function serverAuthHeaders(): Record<string, string> | undefined {
  const password = process.env.OPENCODE_SERVER_PASSWORD;
  if (!password) return undefined;
  const username = process.env.OPENCODE_SERVER_USERNAME ?? "opencode";
  const token = Buffer.from(`${username}:${password}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

/** Исполнитель агентов: attach к бегущему серверу или self-start + авто-апрув permissions. */
export class OpencodeAgentExecutor implements IAgentExecutor {
  readonly id = "opencode";

  private constructor(
    private readonly client: OpencodeClient,
    private readonly eventsAbort: AbortController,
    private readonly server?: { url: string; close(): void }
  ) {}

  static async create(): Promise<OpencodeAgentExecutor> {
    const serverUrl = process.env.OPENCODE_SERVER_URL;
    const directory = process.env.OPENCODE_DIRECTORY;
    const headers = serverAuthHeaders();
    const clientOpts = {
      ...(headers ? { headers } : {}),
      ...(directory ? { directory } : {}),
    };
    let client: OpencodeClient | null = null;
    let server: { url: string; close(): void } | null = null;

    if (serverUrl) {
      const attached = createOpencodeClient({ baseUrl: serverUrl, ...clientOpts });
      try {
        const probe = await attached.app.agents();
        if (probe.error) {
          throw new Error(`server check failed, HTTP ${probe.response?.status}`);
        }
        client = attached;
      } catch (err) {
        console.warn(`cannot reach ${serverUrl}, starting own server: ${String(err)}`);
      }
    }

    if (!client) {
      server = await createOpencodeServer({
        port: 0,
        config: {
          permission: {
            edit: "allow",
            bash: "allow",
            webfetch: "allow",
            doom_loop: "allow",
            external_directory: "allow",
          },
          provider: {
            "opencode-go": {
              models: {
                "muse-spark-1.3-contributor": {
                  options: { reasoningEffort: "minimal" },
                },
              },
            },
          },
        },
      });
      client = createOpencodeClient({ baseUrl: server.url, ...clientOpts });
    }

    const eventsAbort = new AbortController();
    const eventsLoop = (async () => {
      try {
        const { stream } = await client!.global.event({ signal: eventsAbort.signal });
        for await (const evt of stream) {
          try {
            const payload = evt?.payload;
            if (payload?.type === "permission.updated") {
              const p = payload.properties;
              if (p?.sessionID && p?.id) {
                await client!.postSessionIdPermissionsPermissionId({
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

    return new OpencodeAgentExecutor(client, eventsAbort, server ?? undefined);
  }

  async listAgents(): Promise<string[]> {
    const res = await this.client.app.agents();
    return (res.data ?? []).map((a) => a.name);
  }

  async runSession(opts: {
    prompt: string;
    agent?: string;
    sessionTitle?: string;
  }): Promise<PromptSessionResult> {
    const session = await this.client.session.create({
      body: { title: opts.sessionTitle ?? WORKFLOW_TITLE },
    });
    const sessionId = session.data?.id;
    if (!sessionId) throw new Error("session not created");

    await this.client.session.promptAsync({
      path: { id: sessionId },
      body: {
        ...(opts.agent ? { agent: opts.agent } : {}),
        parts: [{ type: "text", text: opts.prompt }],
      },
    });

    const text = await this.waitForCompletion(sessionId);
    return { sessionId, text };
  }

  /**
   * Ожидание завершения turn'а поллингом: закрываемся по completed-флагу
   * последнего сообщения либо по стабильности текста (fallback для провайдеров,
   * не отдающих step-finish / completed).
   */
  private async waitForCompletion(sessionId: string): Promise<string> {
    const timeoutMs = Number(process.env.PHASE_TIMEOUT_MS ?? 20 * 60 * 1000);
    const settleMs = Number(process.env.PHASE_SETTLE_MS ?? 60 * 1000);
    const started = Date.now();
    let lastSignature = "";

    while (Date.now() - started < timeoutMs) {
      const res = await this.client.session.messages({ path: { id: sessionId } });
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
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`phase timed out after ${Math.round((Date.now() - started) / 1000)}s (session ${sessionId})`);
  }

  async close(): Promise<void> {
    this.eventsAbort.abort();
    this.server?.close();
  }
}