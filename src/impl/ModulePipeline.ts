import type { IAgentExecutor } from "../core/executor.ts";
import type { IEventBus } from "../core/events.ts";
import type { IPipelineState, IPipelineStateStore } from "../core/pipeline.ts";
import type { IWorkerRegistry } from "../core/registry.ts";
import type { IWorkflowTask } from "../core/task.ts";
import type { ModuleAction, ModuleDomain, PipelinePhase } from "../core/types.ts";
import type { IModuleWorker } from "../core/worker.ts";
import { GeneralModuleWorker } from "./GeneralModuleWorker.ts";

export interface ModulePipelineConfig {
  maxAttempts?: number;
}

/**
 * Стратегии действий: порядок фаз и фаза возврата на провале verification.
 * add — полный цикл (spec…verification), update — tests-first, delete —
 * удаление + проверка, decompose — только проектирование (spec + plan без кода).
 */
export const ACTION_PHASES: Readonly<Record<ModuleAction, readonly PipelinePhase[]>> = {
  add: ["spec", "planning", "tests", "implementation", "verification"],
  update: ["tests", "implementation", "verification"],
  delete: ["implementation", "verification"],
  decompose: ["spec", "planning"],
};

const BACK_TO: Readonly<Partial<Record<ModuleAction, PipelinePhase>>> = {
  add: "tests",
  update: "tests",
  delete: "implementation",
};

/**
 * Машина состояний разработки модуля. Стартует из задачи: определяет воркер
 * по домену и действию, гонит фазы с возвратом к тестам (add/update) или
 * реализации (delete) на провале verification; исчерпание бюджета → failed.
 * Активные раны трекаются в running и останавливаются через stop() — ран
 * переходит в cancelled, ожидание сессии в исполнителе абортится.
 */
export class ModulePipeline {
  private readonly maxAttempts: number;
  private readonly fallback: IModuleWorker = new GeneralModuleWorker();
  private readonly running = new Map<string, AbortController>();

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

  async start(
    task: IWorkflowTask,
    domain: ModuleDomain,
    action: ModuleAction
  ): Promise<IPipelineState> {
    const runId = `run-${task.source}-${task.externalId}`;
    const stopper = new AbortController();
    this.running.set(runId, stopper);
    try {
      return await this.run(task, domain, action, runId, stopper.signal);
    } finally {
      this.running.delete(runId);
    }
  }

  /**
   * Остановка активного рана: true — сигнал доставлен, ран перейдёт
   * в cancelled; false — ран не выполняется этим процессом.
   */
  stop(runId: string): boolean {
    const stopper = this.running.get(runId);
    if (!stopper) return false;
    stopper.abort();
    return true;
  }

  private async run(
    task: IWorkflowTask,
    domain: ModuleDomain,
    action: ModuleAction,
    runId: string,
    signal: AbortSignal
  ): Promise<IPipelineState> {
    const phases = ACTION_PHASES[action];
    const worker = this.pickWorker(domain, action);
    let state: IPipelineState = {
      runId,
      phase: phases[0] ?? "spec",
      externalId: task.externalId,
      source: task.source,
      attempts: 0,
      action,
    };
    let cursor = 0;

    while (cursor < phases.length) {
      if (signal.aborted) return this.cancel(state);
      const phase = phases[cursor];
      if (!phase) break;
      state = { ...state, phase };
      await this.persist(state);

      const verdict = await this.runPhase(task, worker, action, phase, signal);
      if (signal.aborted) return this.cancel(state);

      if (phase === "verification") {
        if (verdict.error) {
          state = { ...state, error: verdict.error };
          await this.persist(state);
        }
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
            error: verdict.error ?? `verification failed after ${state.attempts + 1} attempt(s)`,
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
        cursor = phases.indexOf(BACK_TO[action] ?? "tests");
        continue;
      }

      if (verdict.error) {
        state = { ...state, phase: "failed", error: verdict.error };
        await this.persist(state);
        this.bus.publish({ type: "pipeline.failed", runId, error: verdict.error });
        return state;
      }
      cursor += 1;
    }

    state = { ...state, phase: "done" };
    await this.persist(state);
    this.bus.publish({ type: "pipeline.done", runId });
    return state;
  }

  private pickWorker(domain: ModuleDomain, action: ModuleAction): IModuleWorker {
    return this.registry.resolve(domain, action)[0] ?? this.fallback;
  }

  private async persist(state: IPipelineState): Promise<void> {
    await this.store.save(state);
    this.bus.publish({ type: "pipeline.phase", runId: state.runId, phase: state.phase });
  }

  /**
   * Финал остановки: состояние cancelled пишется напрямую (без pipeline.phase,
   * чтобы фаза-терминал не попала в граф как текущая), затем — событие отмены.
   */
  private async cancel(state: IPipelineState): Promise<IPipelineState> {
    const cancelled: IPipelineState = { ...state, phase: "cancelled", error: undefined };
    await this.store.save(cancelled);
    this.bus.publish({ type: "pipeline.cancelled", runId: cancelled.runId });
    return cancelled;
  }

  private async runPhase(
    task: IWorkflowTask,
    worker: IModuleWorker,
    action: ModuleAction,
    phase: PipelinePhase,
    signal: AbortSignal
  ): Promise<{ pass: boolean; error?: string }> {
    try {
      const result = await this.executor.runSession({
        agent: worker.agentFor(action, phase),
        sessionTitle: `${task.title} — ${phase}`,
        prompt: worker.promptFor(action, phase, task),
        signal,
      });
      return { pass: worker.verify(result.text) };
    } catch (err) {
      const error = String(err);
      console.warn(`[pipeline] phase ${phase} error: ${error}`);
      return { pass: false, error };
    }
  }
}