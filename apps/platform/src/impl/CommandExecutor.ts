import type { CommandResult, ICommand, ICommandExecutor, IServiceConnector } from "@opencode-workflow/sdk";
import type { ILogger } from "../core/logging.ts";
import { makeLogger } from "./logger.ts";

/** Маршрутизатор команд: реестр коннекторов, выбор по service. */
export class CommandExecutor implements ICommandExecutor {
  private readonly connectors: Map<string, IServiceConnector>;
  private readonly log: ILogger;

  constructor(connectors: readonly IServiceConnector[], log: ILogger = makeLogger("commands")) {
    this.connectors = new Map(connectors.map((c) => [c.service, c]));
    this.log = log;
  }

  async execute(command: ICommand, signal?: AbortSignal): Promise<CommandResult> {
    const connector = this.connectors.get(command.service);
    if (!connector) {
      this.log.error(`no connector for service "${command.service}" (op ${command.op})`);
      return { ok: false, error: `no connector for service "${command.service}"` };
    }
    const startedAt = performance.now();
    const result = await connector.execute(command, signal);
    const ms = Math.round(performance.now() - startedAt);
    if (result.ok) {
      this.log.info(`${command.service}.${command.op} → ok (${ms}ms)`);
    } else {
      this.log.error(`${command.service}.${command.op} → error (${ms}ms): ${result.error}`);
    }
    return result;
  }
}