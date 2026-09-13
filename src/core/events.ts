import type { PipelinePhase } from "./types.ts";
import type { IWorkflowTask } from "./task.ts";

// Событие платформы: то, что watcher/webhook/пайплайн публикуют в шину.
// Потребители (логи, метрики, SSE в webhook) не знают, кто опубликовал.
export type WorkflowEvent =
  | { type: "task.received"; task: IWorkflowTask }
  | { type: "pipeline.phase"; runId: string; phase: PipelinePhase }
  | { type: "pipeline.done"; runId: string }
  | { type: "pipeline.failed"; runId: string; error: string }
  | { type: "pipeline.cancelled"; runId: string };

export interface IEventBus {
  publish(event: WorkflowEvent): void;
  subscribe(listener: (event: WorkflowEvent) => void): () => void;
}

/** Источник событий для поздних потребителей (SSE, дашборды): история в оперативной памяти. */
export interface IEventHistory {
  history(): readonly WorkflowEvent[];
}