import type { IWorkflowTask } from "@opencode-workflow/sdk";
import type { ModuleAction, ModuleDomain, PipelinePhase } from "./types.ts";

/** Единая эволюционирующая форма данных модульного прогона в графе. */
export interface IPipelineData {
  task: IWorkflowTask;
  workflow: string;
  action: ModuleAction;
  domain: ModuleDomain;
  phase: PipelinePhase;
  attempts: number;
  pass?: boolean;
  error?: string;
}