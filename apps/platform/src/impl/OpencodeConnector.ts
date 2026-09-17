import type { CommandResult, ICommand, IServiceConnector } from "@opencode-workflow/sdk";
import type { IAgentExecutor } from "@opencode-workflow/sdk";
import type { IWorktreeApi } from "./OpencodeWorktreeApi.ts";
import { OpencodeWorktreeApi } from "./OpencodeWorktreeApi.ts";

/**
 * Коннектор opencode: оборачивает IAgentExecutor как команду runSession,
 * плюс worktree-операции сервера (ensure/list/remove) — параллельные копии
 * проекта под задачу. Сервер делает git сам; платформе файлы не нужны.
 */
export class OpencodeConnector implements IServiceConnector {
  readonly service = "opencode";

  constructor(
    private readonly executor: IAgentExecutor,
    private readonly worktrees: IWorktreeApi = new OpencodeWorktreeApi()
  ) {}

  canHandle(service: string): boolean {
    return service === this.service;
  }

  async execute(command: ICommand, signal?: AbortSignal): Promise<CommandResult> {
    try {
      switch (command.op) {
        case "runSession":
          return await this.runSession(command, signal);
        case "worktree.ensure":
          return await this.worktreeEnsure(command);
        case "worktree.list":
          return await this.worktreeList(command);
        case "worktree.remove":
          return await this.worktreeRemove(command);
        default:
          return { ok: false, error: `unknown op "${command.op}"` };
      }
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  private async runSession(command: ICommand, signal?: AbortSignal): Promise<CommandResult> {
    const result = await this.executor.runSession({
      prompt: String(command.params.prompt ?? ""),
      ...(typeof command.params.agent === "string" ? { agent: command.params.agent } : {}),
      ...(typeof command.params.sessionTitle === "string" ? { sessionTitle: command.params.sessionTitle } : {}),
      ...(typeof command.params.sessionId === "string" ? { sessionId: command.params.sessionId } : {}),
      ...(typeof command.params.directory === "string" ? { directory: command.params.directory } : {}),
      signal,
    });
    return { ok: true, data: result };
  }

  /**
   * Идемпотентный ensure: worktree с таким именем переиспользуется
   * (повторный ран той же карточки продолжает свою копию).
   */
  private async worktreeEnsure(command: ICommand): Promise<CommandResult> {
    const directory = OpencodeConnector.str(command.params.directory, "directory");
    const name = OpencodeConnector.str(command.params.name, "name");
    const existing = (await this.worktrees.list(directory)).find((w) => w.name === name);
    if (existing) return { ok: true, data: { worktree: existing, reused: true } };
    const worktree = await this.worktrees.create(directory, name);
    return { ok: true, data: { worktree, reused: false } };
  }

  private async worktreeList(command: ICommand): Promise<CommandResult> {
    const directory = OpencodeConnector.str(command.params.directory, "directory");
    return { ok: true, data: { worktrees: await this.worktrees.list(directory) } };
  }

  private async worktreeRemove(command: ICommand): Promise<CommandResult> {
    const directory = OpencodeConnector.str(command.params.directory, "directory");
    const worktreeDirectory = OpencodeConnector.str(command.params.worktreeDirectory, "worktreeDirectory");
    await this.worktrees.remove(directory, worktreeDirectory);
    return { ok: true, data: { directory, worktreeDirectory } };
  }

  private static str(value: unknown, what: string): string {
    if (typeof value !== "string" || !value) throw new Error(`для "opencode.worktree.*" обязателен params.${what}`);
    return value;
  }
}