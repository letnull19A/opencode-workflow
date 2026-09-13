import type { IAgentExecutor } from "../core/executor.ts";
import type { IEventBus } from "../core/events.ts";
import type { IPipelineState, IPipelineStateStore } from "../core/pipeline.ts";
import type { IWorkerRegistry } from "../core/registry.ts";
import type { IWorkflowTask } from "../core/task.ts";
import type { ModuleDomain, PipelinePhase } from "../core/types.ts";
import type { IModuleWorker } from "../core/worker.ts";
import { GeneralModuleWorker } from "./GeneralModuleWorker.ts";

export interface ModulePipelineConfig {
  maxAttempts?: number;
}

const PHASE_ORDER: readonly PipelinePhase[] = [
  "spec",
  "planning",
  "tests",
  "implementation",
  "verification",
];

/**
 * Пайплайн разработки модуля: линейные фазы spec → planning → tests →
 * implementation → verification; при провале verification возврат в tests
 * (бюджет повторов), исчерпание бюджета → failed. Каждую фазу исполняет
 * воркер из IWorkerRegistry (fallback — GeneralModuleWorker).
 */
export class ModulePipeline {
  private readonly maxAttempts: number;
  private readonly fallback: IModuleWorker = new GeneralModuleWorker();

  constructor(
    private readonly executor: IAgentExecutor,
    private readonly store: IPipelineStateStore,
    private readonly bus: IEventBus,
    private readonly registry: IWorkerRegistry,
    config: ModulePipelineConfig = {}
  ) {
    this.maxAttempts = config.maxAttempts
      ?? Number(process.env.PIPELINE_MAX_RETRIES ?? 3);
  }

  async start(task: IWorkflowTask, domain: ModuleDomain): Promise<IPipelineState> {
    const runId = `run-${task.source}-${task.externalId}`;
    let state: IPipelineState = {
      runId,
      phase: "spec",
      externalId: task.externalId,
      source: task.source,
      attempts: 0,
    };
    const worker = this.pickWorker(domain);

    let cursor = PHASE_ORDER.indexOf("spec");
    while (cursor < PHASE_ORDER.length) {
      const phase = PHASE_ORDER[cursor];
      if (!phase) break;
      state = { ...state, phase };
      await this.persist(state);

      if (phase === "verification") {
        const verdict = await this.runPhase(task, worker, phase);
        if (verdict.pass) {
          state = { ...state, phase: "done" };
          await this.persist(state);
          this.bus.publish({ type: "pipeline.done", runId });
          return state;
        }
        if (state.attempts + 1 >= this.maxAttempts) {
          state = {
            ...state,
            phase: "failed",
            error: `verification failed after ${state.attempts + 1} attempt(s)`,
          };
          await this.persist(state);
          this.bus.publish({
            type: "pipeline.failed",
            runId,
            error: state.error ?? "verification failed",
          });
          return state;
        }
        state = { ...state, attempts: state.attempts + 1 };
        cursor = PHASE_ORDER.indexOf("tests");
        continue;
      }

      await this.runPhase(task, worker, phase);
      cursor += 1;
    }

    state = { ...state, phase: "done" };
    await this.persist(state);
    this.bus.publish({ type: "pipeline.done", runId });
    return state;
  }

  private pickWorker(domain: ModuleDomain): IModuleWorker {
    return this.registry.resolve(domain, "add")[0] ?? this.fallback;
  }

  private async persist(state: IPipelineState): Promise<void> {
    await this.store.save(state);
    this.bus.publish({ type: "pipeline.phase", runId: state.runId, phase: state.phase });
  }

  private async runPhase(
    task: IWorkflowTask,
    worker: IModuleWorker,
    phase: PipelinePhase
  ): Promise<{ pass: boolean }> {
    const result = await this.executor.runSession({
      sessionTitle: `${task.title} — ${phase}`,
      prompt: worker.promptFor(phase, task),
    });
    return { pass: worker.verify(result.text) };
  }
}