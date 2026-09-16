import type { CommandResult, ICommand, IServiceConnector } from "@opencode-workflow/sdk";

const TRELLO_API = "https://api.trello.com/1";

function strParam(params: Readonly<Record<string, unknown>>, name: string): string {
  return typeof params[name] === "string" ? (params[name] as string) : "";
}

/** params.key/params.token перекрывают env — путь для секретов из vault. */
function apiKey(params?: Readonly<Record<string, unknown>>): string {
  const key = (params && strParam(params, "key")) || (process.env.TRELLO_API_KEY ?? "");
  const token = (params && strParam(params, "token")) || (process.env.TRELLO_TOKEN ?? "");
  if (!key || !token) {
    throw new Error("TRELLO_API_KEY и TRELLO_TOKEN должны быть в env (см. trello-task/README.md) либо в params (vault)");
  }
  return key;
}

function token(params?: Readonly<Record<string, unknown>>): string {
  return (params && strParam(params, "token")) || (process.env.TRELLO_TOKEN ?? "");
}

/**
 * Коннектор Trello: низкоуровневые операции карточек/досок/листов через REST.
 * Секреты — из env (TRELLO_API_KEY, TRELLO_TOKEN) либо params.key/params.token
 * (путь для значений из vault, перекрывают env).
 */
export class TrelloConnector implements IServiceConnector {
  readonly service = "trello";

  canHandle(service: string): boolean {
    return service === this.service;
  }

  async execute(command: ICommand, signal?: AbortSignal): Promise<CommandResult> {
    try {
      switch (command.op) {
        case "boards.list":
          return this.ok(await this.get("/members/me/boards", { fields: "id,name" }, command.params, signal));
        case "lists.list":
          return this.ok(await this.get(`/boards/${command.params.boardId}/lists`, { fields: "id,name" }, command.params, signal));
        case "cards.list":
          return this.ok(await this.get(`/lists/${command.params.listId}/cards`, this.queryParams(command.params), command.params, signal));
        case "cards.move":
          return this.ok(await this.put(`/cards/${command.params.cardId}`, this.queryParams(command.params), command.params, signal));
        default:
          return { ok: false, error: `unknown op "${command.op}"` };
      }
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  private queryParams(params: Readonly<Record<string, unknown>>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) out[key] = String(value);
    }
    return out;
  }

  private async get<T>(
    path: string,
    params: Record<string, string>,
    creds?: Readonly<Record<string, unknown>>,
    signal?: AbortSignal
  ): Promise<T> {
    const query = new URLSearchParams({ key: apiKey(creds), token: token(creds), ...params });
    const res = await fetch(`${TRELLO_API}${path}?${query}`, { signal });
    if (!res.ok) throw new Error(`Trello GET ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  private async put<T>(
    path: string,
    params: Record<string, string>,
    creds?: Readonly<Record<string, unknown>>,
    signal?: AbortSignal
  ): Promise<T> {
    const query = new URLSearchParams({ key: apiKey(creds), token: token(creds), ...params });
    const res = await fetch(`${TRELLO_API}${path}?${query}`, { method: "PUT", signal });
    if (!res.ok) throw new Error(`Trello PUT ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  private ok(data: unknown): CommandResult {
    return { ok: true, data };
  }
}