import type {
  IEventBus as IEventBusGeneric,
  IEventHistory as IEventHistoryGeneric,
  IWorkflowTask,
} from "@opencode-workflow/sdk";
import type { ModuleAction, ModuleDomain } from "./types.ts";

// Событие платформы: то, что watcher/webhook/dispatcher/пайплайн публикуют
// в шину. Потребители (логи, метрики, SSE) не знают, кто опубликовал.
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
  | { type: "task.moved"; task: IWorkflowTask; fromList: string; toList: string }
  | {
      type: "pipeline.started";
      runId: string;
      workflow: string;
      task: IWorkflowTask;
      action?: ModuleAction;
      domain?: ModuleDomain;
    }
  | { type: "pipeline.phase"; runId: string; phase: string }
  | { type: "pipeline.done"; runId: string }
  | { type: "pipeline.failed"; runId: string; error: string }
  | { type: "pipeline.cancelled"; runId: string }
  | { type: "pipeline.delivered"; runId: string; commit?: string; pushed: boolean }
  | { type: "pipeline.delivery_failed"; runId: string; error: string }
  | {
      type: "workflow.registered";
      workflowId: string;
      label: string;
      phases?: readonly string[];
    }
  | {
      type: "workflow.updated";
      workflowId: string;
      label: string;
      phases?: readonly string[];
    }
  | { type: "workflow.removed"; workflowId: string }
  | { type: "workflow.error"; workflowId: string; error: string }
  | { type: "entrypoint.ignored"; hookId: string | null; reason: EntryPointIgnoreReason; detail?: string };

export type IEventBus = IEventBusGeneric<WorkflowEvent>;
export type IEventHistory = IEventHistoryGeneric<WorkflowEvent>;