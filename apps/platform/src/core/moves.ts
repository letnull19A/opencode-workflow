import type { IWorkflowTask, ITaskSource } from "@opencode-workflow/sdk";

/** Текущая позиция карточки: задача + имя листа, где она лежит. */
export interface ITaskPosition {
  task: IWorkflowTask;
  list: string;
}

/**
 * Источник, умеющий отдавать карту «карточка → лист» (для детекции
 * перемещений по диффу между поллами). Реализует TrelloTaskSource;
 * файловые/прочие источники остаются ITaskSource и перемещений не дают.
 */
export interface IPositionedTaskSource extends ITaskSource {
  fetchPositions(limit?: number): Promise<ITaskPosition[]>;
}

/** Факт перемещения карточки между листами (для task.moved). */
export interface ITaskMove {
  task: IWorkflowTask;
  fromList: string;
  toList: string;
}