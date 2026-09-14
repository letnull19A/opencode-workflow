import type { CommandResult, ICommand, IServiceConnector } from "../core/command.ts";
import type { IAgentExecutor } from "../core/executor.ts";

/**
 * Коннектор opencode: оборачивает IAgentExecutor как команду runSession.
 * Позволяет нодам графа презентовать агентскую сессию тем же командным слоем.
 */
export class OpencodeConnector implements IServiceConnector {
  readonly service = "opencode";

  constructor(private readonly executor: IAgentExecutor) {}

  canHandle(service: string): boolean {
    return service === this.service;
  }

  async execute(command: ICommand, signal?: AbortSignal): Promise<CommandResult> {
    if (command.op !== "runSession") {
      return { ok: false, error: `unknown op "${command.op}"` };
    }
    try {
      const result = await this.executor.runSession({
        prompt: String(command.params.prompt ?? ""),
        ...(typeof command.params.agent === "string" ? { agent: command.params.agent } : {}),
        ...(typeof command.params.sessionTitle === "string" ? { sessionTitle: command.params.sessionTitle } : {}),
        signal,
      });
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
}