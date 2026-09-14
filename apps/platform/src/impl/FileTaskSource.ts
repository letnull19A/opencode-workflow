import type { ITaskSource, IWorkflowTask } from "@opencode-workflow/sdk";

/**
 * Источник задач из локального JSON-файла (офлайн-демо без Trello).
 * Файл: массив IWorkflowTask. ackTask — no-op (файл read-only).
 */
export class FileTaskSource implements ITaskSource {
  readonly id = "file";

  constructor(private readonly filePath: string) {}

  static fromEnv(): FileTaskSource {
    return new FileTaskSource(process.env.TASK_SOURCE_FILE ?? "tasks.json");
  }

  async fetchNewTasks(limit = 50): Promise<IWorkflowTask[]> {
    const raw = await Bun.file(this.filePath).text();
    const tasks = JSON.parse(raw) as IWorkflowTask[];
    return tasks.slice(0, limit);
  }

  async ackTask(): Promise<void> {}
}