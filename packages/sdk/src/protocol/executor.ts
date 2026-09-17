/** Результат одного прогона агента: без привязки к платформе. */
export type PromptSessionResult = {
  sessionId: string;
  text: string;
};

/** Краткая сводка сессии сервера (история, без сообщений). */
export interface SessionSummary {
  readonly sessionId: string;
  readonly title: string;
  readonly directory: string;
  readonly updatedAt: string;
}

/** Исполнитель агента (opencode server) — протокол, реализация на платформе.
 * Соединение — только к существующему серверу (attach по OPENCODE_SERVER_URL);
 * нет соединения — OpencodeConnectionError, сервер сами не поднимаем. */
export interface IAgentExecutor {
  listAgents(): Promise<string[]>;
  /** Создать пустую сессию (нода «создать сессию»); бросает OpencodeSessionCreateError. */
  createSession(title?: string, directory?: string): Promise<string>;
  runSession(opts: {
    prompt: string;
    agent?: string;
    sessionTitle?: string;
    /** Продолжить существующую сессию вместо создания новой (нода «работать с сессией»). */
    sessionId?: string;
    /** Директория проекта на сервере (per-request); пусто — cwd сервера. */
    directory?: string;
    /** Остановка долгой сессии: workflow абортит ожидание и помечает ран cancelled. */
    signal?: AbortSignal;
  }): Promise<PromptSessionResult>;
  /** История сессий сервера (для контекста и отчётности); directory сужает до проекта. */
  listSessions(opts?: { directory?: string; limit?: number }): Promise<SessionSummary[]>;
  /** Остановить executor (оборвать event-loop, закрыть соединения). */
  close(): Promise<void>;
}