/** Результат одного прогона агента: без привязки к платформе. */
export type PromptSessionResult = {
  sessionId: string;
  text: string;
};

/** Исполнитель агента (opencode server) — протокол, реализация на платформе.
 * Соединение — только к существующему серверу (attach по OPENCODE_SERVER_URL);
 * нет соединения — OpencodeConnectionError, сервер сами не поднимаем. */
export interface IAgentExecutor {
  listAgents(): Promise<string[]>;
  /** Создать пустую сессию (нода «создать сессию»); бросает OpencodeSessionCreateError. */
  createSession(title?: string): Promise<string>;
  runSession(opts: {
    prompt: string;
    agent?: string;
    sessionTitle?: string;
    /** Продолжить существующую сессию вместо создания новой (нода «работать с сессией»). */
    sessionId?: string;
    /** Остановка долгой сессии: workflow абортит ожидание и помечает ран cancelled. */
    signal?: AbortSignal;
  }): Promise<PromptSessionResult>;
  /** Остановить executor (оборвать event-loop, закрыть соединения). */
  close(): Promise<void>;
}