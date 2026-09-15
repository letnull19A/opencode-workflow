import { describe, expect, test } from "bun:test";
import type { LogLevel } from "../core/logging.ts";
import { makeLogger, resolveLogLevel } from "./logger.ts";

const LEVELS: readonly LogLevel[] = ["silent", "error", "warn", "info", "debug"];

function captureLogs(run: () => void): string[] {
  const lines: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const collect = (message?: unknown, ...optionalParams: unknown[]): void => {
    lines.push([message, ...optionalParams].join(" "));
  };
  console.log = collect as unknown as typeof console.log;
  console.error = collect as unknown as typeof console.error;
  try {
    run();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return lines;
}

describe("resolveLogLevel", () => {
  test("по умолчанию info", () => {
    expect(resolveLogLevel(undefined)).toBe("info");
  });

  test("неизвестное значение сводится к info", () => {
    expect(resolveLogLevel("verbose")).toBe("info");
  });

  test("валидные уровни проходят", () => {
    for (const level of LEVELS) {
      expect(resolveLogLevel(level)).toBe(level);
    }
  });
});

describe("makeLogger", () => {
  test("фильтрует ниже порога уровня", () => {
    const lines = captureLogs(() => {
      const logger = makeLogger("test", "warn");
      logger.debug("no");
      logger.info("no");
      logger.warn("yes");
      logger.error("yes");
    });
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("yes");
    expect(lines[1]).toContain("yes");
  });

  test("добавляет namespace и таймстамп", () => {
    const lines = captureLogs(() => {
      makeLogger("ns").info("hello");
    });
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("[ns]");
    expect(lines[0]).toContain("hello");
    expect(lines[0]).toMatch(/^\d{4}-/);
  });
});