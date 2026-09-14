import type { ModuleAction, ModuleDomain, PipelinePhase } from "./types.ts";
import type { IWorkflowTask } from "@opencode-workflow/sdk";

export interface IModuleWorker {
  readonly id: string;
  readonly domain: ModuleDomain;
  canHandle(action: ModuleAction): boolean;
  promptFor(action: ModuleAction, phase: PipelinePhase, task: IWorkflowTask): string;
  verify(text: string): boolean;
  agentFor(action: ModuleAction, phase: PipelinePhase): string | undefined;
}