/** Уровни логирования; фильтрация «не грубее уровня». */
export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

/** Функция-вывод одной строки лога. */
export type LogFn = (message: string) => void;

/** Интерфейс логгера: уровневые sinks + текущий уровень. */
export interface ILogger {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  readonly level: LogLevel;
}