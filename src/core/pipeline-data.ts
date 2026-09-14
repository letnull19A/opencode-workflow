import type { IWorkflowTask } from "../core/task.ts";
import type { ModuleAction, ModuleDomain, PipelinePhase } from "../core/types.ts";

/** Единая эволюционирующая форма данных модульного прогона в графе. */
export interface IPipelineData {
  task: IWorkflowTask;
  action: ModuleAction;
  domain: ModuleDomain;
  phase: PipelinePhase;
  attempts: number;
  pass?: boolean;
  error?: string;
}