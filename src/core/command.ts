/**
 * Низкоуровневый командный слой: единый транспорт для внешних сервисов
 * (Trello, GitHub, opencode). Источники и pipeline говорят с сервисами
 * только через ICommandExecutor — сырой fetch остаётся внутри коннекторов.
 */

export interface ICommand {
  readonly service: string;
  readonly op: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export type CommandResult =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly error: string };

export interface IServiceConnector {
  readonly service: string;
  canHandle(service: string): boolean;
  execute(command: ICommand, signal?: AbortSignal): Promise<CommandResult>;
}

export interface ICommandExecutor {
  execute(command: ICommand, signal?: AbortSignal): Promise<CommandResult>;
}