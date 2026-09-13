import type { ITaskSource, IWorkflowTask } from "../core/task.ts";

const TRELLO_API = "https://api.trello.com/1";

interface TrelloCard {
  id: string;
  name: string;
  desc?: string;
  url?: string;
  idList?: string;
  labels?: Array<{ name?: string; id?: string }>;
  attachments?: Array<{ name?: string; url?: string }>;
}

/**
 * Источник задач из Trello: карточки входного листа → IWorkflowTask,
 * ack перемещает карточку в Done-лист (как move.sh пак-а).
 * Ключи — только из env: TRELLO_API_KEY, TRELLO_TOKEN.
 */
export class TrelloTaskSource implements ITaskSource {
  readonly id = "trello";

  constructor(private readonly config: TrelloTaskSourceConfig) {}

  static fromEnv(): TrelloTaskSource {
    return new TrelloTaskSource({
      apiKey: process.env.TRELLO_API_KEY ?? "",
      token: process.env.TRELLO_TOKEN ?? "",
      board: process.env.TRELLO_BOARD ?? "",
      inboxList: process.env.TRELLO_INBOX_LIST ?? "Inbox",
      doneList: process.env.TRELLO_DONE_LIST ?? "Done",
    });
  }

  private get creds() {
    const { apiKey, token } = this.config;
    if (!apiKey || !token) {
      throw new Error("TRELLO_API_KEY и TRELLO_TOKEN должны быть в env (см. trello-task/README.md)");
    }
    return { key: apiKey, token };
  }

  async fetchNewTasks(limit = 50): Promise<IWorkflowTask[]> {
    const inboxListId = await this.listId(this.config.inboxList);
    const cards = await this.get<TrelloCard[]>(
      `/lists/${inboxListId}/cards`,
      { filter: "open", limit: String(limit), attachments: "true", fields: "id,name,desc,url,idList,labels,attachments" }
    );
    return cards.map((c) => this.toTask(c));
  }

  async ackTask(task: IWorkflowTask): Promise<void> {
    const doneListId = await this.listId(this.config.doneList);
    await this.put(`/cards/${task.externalId}`, { idList: doneListId });
  }

  private toTask(card: TrelloCard): IWorkflowTask {
    return {
      externalId: card.id,
      source: "trello",
      title: card.name,
      description: card.desc,
      url: card.url,
      labels: card.labels?.map((l) => l.name).filter((n): n is string => !!n),
      attachments: card.attachments?.map((a) => ({
        name: a.name ?? "attachment",
        url: a.url ?? "",
        kind: "link" as const,
      })),
      createdAt: new Date().toISOString(),
    };
  }

  private async listId(listName: string): Promise<string> {
    const boards = await this.get<Array<{ id: string; name?: string }>>(
      `/members/me/boards`,
      { filter: "open", fields: "id,name" }
    );
    let board = boards.find((b) => b.name === this.config.board) ?? boards[0];
    if (!board) throw new Error(`доска "${this.config.board}" не найдена`);
    const lists = await this.get<Array<{ id: string; name?: string }>>(
      `/boards/${board.id}/lists`,
      { filter: "open", fields: "id,name" }
    );
    const found = lists.find((l) => l.name === listName);
    if (!found) throw new Error(`лист "${listName}" не найден на доске "${board.name}"`);
    return found.id;
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const query = new URLSearchParams({ ...this.creds, ...params });
    const res = await fetch(`${TRELLO_API}${path}?${query}`);
    if (!res.ok) throw new Error(`Trello GET ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  private async put(path: string, params: Record<string, string>): Promise<void> {
    const query = new URLSearchParams({ ...this.creds, ...params });
    const res = await fetch(`${TRELLO_API}${path}?${query}`, { method: "PUT" });
    if (!res.ok) throw new Error(`Trello PUT ${path}: HTTP ${res.status}`);
  }
}

export interface TrelloTaskSourceConfig {
  apiKey: string;
  token: string;
  board: string;
  inboxList: string;
  doneList: string;
}