import type { IWorkflowTask } from "@opencode-workflow/sdk";
import type { IWorkflowHandle } from "../core/workflows.ts";
import type { ModulePipeline } from "./ModulePipeline.ts";
import { resolveAction, resolveDomain } from "./ModuleMatcher.ts";

/** Встроенная workflow «module»: обёртка над ModulePipeline для реестра. */
export class ModuleWorkflow implements IWorkflowHandle {
  readonly id = "module";
  readonly label = "Module pipeline";
  readonly phases: readonly string[] = ["spec", "planning", "tests", "implementation", "verification"];

  constructor(private readonly pipeline: ModulePipeline) {}

  async start(task: IWorkflowTask): Promise<string> {
    const runId = `run-${task.source}-${task.externalId}`;
    const domain = resolveDomain(task);
    const action = resolveAction(task);
    void this.pipeline
      .start(task, domain, action)
      .then((state) => {
        console.log(`[workflow] ${state.runId} finished in ${state.phase}${state.error ? `: ${state.error}` : ""}`);
      })
      .catch((err) => console.error(`[workflow] ${runId}: ${String(err)}`));
    return runId;
  }

  stop(runId: string): boolean {
    return this.pipeline.stop(runId);
  }
}