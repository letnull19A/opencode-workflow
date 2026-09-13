import type { PromptSessionResult } from "./types.ts";

export interface IAgentExecutor {
  listAgents(): Promise<string[]>;
  runSession(opts: {
    prompt: string;
    agent?: string;
    sessionTitle?: string;
    /** Остановка долгой сессии: пайплайн абортит ожидание и помечает ран cancelled. */
    signal?: AbortSignal;
  }): Promise<PromptSessionResult>;
}
