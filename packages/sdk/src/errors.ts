/**
 * Иерархия ошибок opencode-домена (наследование — для точной диагностики
 * и семантики в коде). Значений секретов в сообщениях нет — только
 * url/id/title. Проверяй через instanceof от частного к общему.
 */

/** Базовая ошибка opencode-домена. */
export class OpencodeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OpencodeError";
  }
}

/**
 * Нет соединения с сервером (UNIX: ошибка выполнения, не повод
 * поднимать сервер самим — см. AGENTS.md Philosophy).
 */
export class OpencodeConnectionError extends OpencodeError {
  readonly url: string;
  constructor(url: string, cause?: unknown) {
    super(
      url ? `opencode: нет соединения с сервером ${url}` : "opencode: OPENCODE_SERVER_URL не задан",
      cause === undefined ? undefined : { cause }
    );
    this.name = "OpencodeConnectionError";
    this.url = url;
  }
}

/** Нода «создать сессию»: сервер отказал в создании сессии. */
export class OpencodeSessionCreateError extends OpencodeError {
  readonly title: string;
  constructor(title: string, cause?: unknown) {
    super(
      `opencode: не создана сессия "${title}"`,
      cause === undefined ? undefined : { cause }
    );
    this.name = "OpencodeSessionCreateError";
    this.title = title;
  }
}

/** Нода «работать с сессией»: промпт в существующую сессию не ушёл. */
export class OpencodeSessionPromptError extends OpencodeError {
  readonly sessionId: string;
  constructor(sessionId: string, message: string, cause?: unknown) {
    super(
      sessionId ? `opencode: сессия ${sessionId}: ${message}` : `opencode: ${message}`,
      cause === undefined ? undefined : { cause }
    );
    this.name = "OpencodeSessionPromptError";
    this.sessionId = sessionId;
  }
}

/** Нода «worktree»: параллельная копия проекта не создана/не найдена. */
export class OpencodeWorktreeError extends OpencodeError {
  readonly worktreeName: string;
  constructor(worktreeName: string, message: string, cause?: unknown) {
    super(
      worktreeName ? `opencode: worktree "${worktreeName}": ${message}` : `opencode: ${message}`,
      cause === undefined ? undefined : { cause }
    );
    this.name = "OpencodeWorktreeError";
    this.worktreeName = worktreeName;
  }
}
