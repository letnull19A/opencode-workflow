import type { PipelinePhase, ModuleAction, ModuleDomain } from "./types.ts";
import type { IWorkflowTask } from "./task.ts";

// Событие платформы: то, что watcher/webhook/пайплайн публикуют в шину.
// Потребители (логи, метрики, SSE в webhook) не знают, кто опубликовал.
export type EntryPointIgnoreReason =
  | "unknown_binding"
  | "binding_disabled"
  | "bad_signature"
  | "misconfigured"
  | "filter_mismatch"
  | "matcher_reject"
  | "duplicate_delivery";

export type WorkflowEvent =
  | { type: "task.received"; task: IWorkflowTask }
  | { type: "pipeline.started"; runId: string; task: IWorkflowTask; action: ModuleAction; domain: ModuleDomain }
  | { type: "pipeline.phase"; runId: string; phase: PipelinePhase }
  | { type: "pipeline.done"; runId: string }
  | { type: "pipeline.failed"; runId: string; error: string }
  | { type: "pipeline.cancelled"; runId: string }
  | { type: "pipeline.delivered"; runId: string; commit?: string; pushed: boolean }
  | { type: "pipeline.delivery_failed"; runId: string; error: string }
  | { type: "entrypoint.ignored"; hookId: string | null; reason: EntryPointIgnoreReason; detail?: string };

export interface IEventBus {
  publish(event: WorkflowEvent): void;
  subscribe(listener: (event: WorkflowEvent) => void): () => void;
}

/** Источник событий для поздних потребителей (SSE, дашборды): история в оперативной памяти. */
export interface IEventHistory {
  history(): readonly WorkflowEvent[];
}