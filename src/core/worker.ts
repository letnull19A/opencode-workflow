import type { ModuleAction, ModuleDomain, PipelinePhase } from "./types.ts";
import type { IWorkflowTask } from "./task.ts";

export interface IModuleWorker {
  readonly id: string;
  readonly domain: ModuleDomain;
  canHandle(action: ModuleAction): boolean;
  promptFor(phase: PipelinePhase, task: IWorkflowTask): string;
  verify(text: string): boolean;
}