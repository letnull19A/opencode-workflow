import type { IWorkflowTask } from "@opencode-workflow/sdk";

/**
 * Зарегистрированная workflow: единая точка запуска/остановки для платформы.
 * Модульный пайплайн и кастомные графы предоставляют один и тот же handling:
 * start возвращает runId (null — задача отклонена), stop — доставил ли сигнал.
 */
export interface IWorkflowHandle {
  readonly id: string;
  readonly label: string;
  readonly phases?: readonly string[];
  start(task: IWorkflowTask): Promise<string | null>;
  stop(runId: string): boolean;
}

export interface IWorkflowRegistry {
  register(handle: IWorkflowHandle): void;
  unregister(id: string): boolean;
  resolve(id?: string): IWorkflowHandle | undefined;
  list(): IWorkflowHandle[];
}