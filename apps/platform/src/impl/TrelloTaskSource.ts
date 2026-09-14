import type { ICommandExecutor } from "@opencode-workflow/sdk";
import type { ITaskSource, IWorkflowTask } from "@opencode-workflow/sdk";

interface TrelloCard {
  id: string;
  name: string;
  desc?: string;
  url?: string;
  idList?: string;
  labels?: Array<{ name?: string; id?: string }>;
  attachments?: Array<{ name?: string; url?: string }>;
}

interface TrelloList {
  id: string;
  name: string;
}

/**
 * Источник задач из Trello: карточки входного листа → IWorkflowTask,
 * ack перемещает карточку в Done-лист. Низкий уровень — через
 * ICommandExecutor (TrelloConnector): сырого fetch здесь нет.
 */
export class TrelloTaskSource implements ITaskSource {
  readonly id = "trello";

  constructor(
    private readonly config: TrelloTaskSourceConfig,
    private readonly commands: ICommandExecutor
  ) {}

  static fromEnv(commands: ICommandExecutor): TrelloTaskSource {
    return new TrelloTaskSource(
      {
        board: process.env.TRELLO_BOARD ?? "",
        inboxList: process.env.TRELLO_INBOX_LIST ?? "Inbox",
        doneList: process.env.TRELLO_DONE_LIST ?? "Done",
      },
      commands
    );
  }

  async fetchNewTasks(limit = 50): Promise<IWorkflowTask[]> {
    const inboxListId = await this.listId(this.config.inboxList);
    const cards = await this.call<TrelloCard[]>("cards.list", {
      listId: inboxListId,
      filter: "open",
      limit: String(limit),
      attachments: "true",
      fields: "id,name,desc,url,idList,labels,attachments",
    });
    return (cards ?? []).map((c) => this.toTask(c));
  }

  async ackTask(task: IWorkflowTask): Promise<void> {
    const doneListId = await this.listId(this.config.doneList);
    await this.call(`cards.move`, { cardId: task.externalId, idList: doneListId });
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
    const boards = await this.call<Array<{ id: string; name?: string }>>("boards.list", {});
    let board = (boards ?? []).find((b) => b.name === this.config.board) ?? (boards ?? [])[0];
    if (!board) throw new Error(`доска "${this.config.board}" не найдена`);
    const lists = await this.call<TrelloList[]>("lists.list", { boardId: board.id });
    const found = (lists ?? []).find((l) => l.name === listName);
    if (!found) throw new Error(`лист "${listName}" не найден на доске "${board.name}"`);
    return found.id;
  }

  private async call<T>(op: string, params: Record<string, unknown>): Promise<T | null> {
    const result = await this.commands.execute({ service: "trello", op, params });
    if (!result.ok) throw new Error(`Trello ${op}: ${result.error}`);
    return result.data as T;
  }
}

export interface TrelloTaskSourceConfig {
  board: string;
  inboxList: string;
  doneList: string;
}