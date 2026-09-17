import type { IAgentExecutor, PromptSessionResult, SessionSummary } from "@opencode-workflow/sdk";

/**
 * Offline-заглушка executor'а: платформа стартует и живёт без opencode-сервера
 * (UNIX: падай локально — HTTP/vault/webhook работают), а любое обращение
 * к агенту бросает исходную ошибку соединения явно.
 */
export class OfflineAgentExecutor implements IAgentExecutor {
  readonly id = "opencode-offline";

  constructor(private readonly reason: unknown) {}

  async listAgents(): Promise<string[]> {
    throw this.reason;
  }

  async createSession(_title?: string, _directory?: string): Promise<string> {
    throw this.reason;
  }

  async runSession(_opts: {
    prompt: string;
    agent?: string;
    sessionTitle?: string;
    sessionId?: string;
    directory?: string;
    signal?: AbortSignal;
  }): Promise<PromptSessionResult> {
    throw this.reason;
  }

  async listSessions(_opts?: { directory?: string; limit?: number }): Promise<SessionSummary[]> {
    throw this.reason;
  }

  async close(): Promise<void> {}
}
