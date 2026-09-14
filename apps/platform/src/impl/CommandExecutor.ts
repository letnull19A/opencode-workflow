import type { CommandResult, ICommand, ICommandExecutor, IServiceConnector } from "@opencode-workflow/sdk";

/** Маршрутизатор команд: реестр коннекторов, выбор по service. */
export class CommandExecutor implements ICommandExecutor {
  private readonly connectors: Map<string, IServiceConnector>;

  constructor(connectors: readonly IServiceConnector[]) {
    this.connectors = new Map(connectors.map((c) => [c.service, c]));
  }

  async execute(command: ICommand, signal?: AbortSignal): Promise<CommandResult> {
    const connector = this.connectors.get(command.service);
    if (!connector) return { ok: false, error: `no connector for service "${command.service}"` };
    return connector.execute(command, signal);
  }
}