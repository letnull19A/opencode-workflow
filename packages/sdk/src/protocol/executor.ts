/** Результат одного прогона агента: без привязки к платформе. */
export type PromptSessionResult = {
  sessionId: string;
  text: string;
};

/** Исполнитель агента (opencode server) — протокол, реализация на платформе. */
export interface IAgentExecutor {
  listAgents(): Promise<string[]>;
  runSession(opts: {
    prompt: string;
    agent?: string;
    sessionTitle?: string;
    /** Остановка долгой сессии: workflow абортит ожидание и помечает ран cancelled. */
    signal?: AbortSignal;
  }): Promise<PromptSessionResult>;
}