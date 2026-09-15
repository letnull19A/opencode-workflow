import type { ILogger, LogLevel } from "../core/logging.ts";

const RANKS: Record<LogLevel, number> = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

/**
 * Текущий уровень из LOG_LEVEL (по умолчанию "info"); неизвестные значения
 * считаются info — ложный уровень не блокирует диагностику.
 */
export function resolveLogLevel(raw?: string): LogLevel {
  const value = (raw ?? process.env.LOG_LEVEL ?? "info").toLowerCase();
  return value === "silent" || value === "error" || value === "warn" || value === "info" || value === "debug"
    ? value
    : "info";
}

/**
 * Фабрика логгера с namespace-префиксом и таймстампом ISO.
 * warn/error — в stderr, info/debug — в stdout; фильтрация по LOG_LEVEL.
 */
export function makeLogger(namespace: string, level?: LogLevel): ILogger {
  const threshold = RANKS[resolveLogLevel(level)];
  const emit = (rank: number, target: "stdout" | "stderr") => (message: string): void => {
    if (rank > threshold) return;
    const line = `${new Date().toISOString()} [${namespace}] ${message}`;
    (target === "stderr" ? console.error : console.log)(line);
  };
  return {
    debug: emit(RANKS.debug, "stdout"),
    info: emit(RANKS.info, "stdout"),
    warn: emit(RANKS.warn, "stderr"),
    error: emit(RANKS.error, "stderr"),
    level: resolveLogLevel(level),
  };
}