import type { ModuleAction, PipelinePhase } from "./types.ts";

export interface IPipelineState {
  runId: string;
  phase: PipelinePhase;
  externalId: string;
  source: string;
  attempts: number;
  action: ModuleAction;
  error?: string;
}

export interface IPipelineStateStore {
  load(runId: string): Promise<IPipelineState | null>;
  save(state: IPipelineState): Promise<void>;
}
