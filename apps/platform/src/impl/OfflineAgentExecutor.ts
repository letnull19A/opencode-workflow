import type { IAgentExecutor, PromptSessionResult } from "@opencode-workflow/sdk";

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

  async createSession(_title?: string): Promise<string> {
    throw this.reason;
  }

  async runSession(_opts: {
    prompt: string;
    agent?: string;
    sessionTitle?: string;
    sessionId?: string;
    signal?: AbortSignal;
  }): Promise<PromptSessionResult> {
    throw this.reason;
  }

  async close(): Promise<void> {}
}
