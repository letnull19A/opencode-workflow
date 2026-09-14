export interface ITaskAttachment {
  name: string;
  url: string;
  kind?: "image" | "file" | "link";
}

/** Нормализованная задача — источнику (Trello/файл/webhook) безразлично. */
export interface IWorkflowTask {
  externalId: string;
  source: string;
  title: string;
  description?: string;
  url?: string;
  labels?: string[];
  attachments?: ITaskAttachment[];
  createdAt: string;
  meta?: Readonly<Record<string, unknown>>;
}

/** Источник задач. Клиент (пайплайн/оркестратор) работает ТОЛЬКО с этим
 * интерфейсом: смена Trello -> Vikunja -> файл = замена реализации, не логики. */
export interface ITaskSource {
  readonly id: string;
  fetchNewTasks(limit?: number): Promise<IWorkflowTask[]>;
  ackTask(task: IWorkflowTask): Promise<void>;
}