import type { IAgentExecutor } from "@opencode-workflow/sdk";
import type { IEventBus } from "../core/events.ts";
import type { INode, INodeContext, INodeExecutor } from "@opencode-workflow/sdk";
import type { IPipelineData } from "../core/pipeline-data.ts";
import type { IPipelineState, IPipelineStateStore } from "../core/pipeline.ts";
import type { IWorkerRegistry } from "../core/registry.ts";
import type { IWorkflowTask } from "@opencode-workflow/sdk";
import type { ModuleAction, ModuleDomain, PipelinePhase } from "../core/types.ts";
import type { IModuleWorker } from "../core/worker.ts";
import { GeneralModuleWorker } from "./GeneralModuleWorker.ts";
import { MapNodeContext } from "../engine/MapNodeContext.ts";
import { NodeGraphBuilder } from "../engine/NodeGraphBuilder.ts";
import { DepthFirstNodeRunner } from "../engine/DepthFirstNodeRunner.ts";

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
 * Машина состояний разработки модуля на графе нод. Каждая фаза — нода,
 * verification ветвится гардами на retry/fail/done (совпадает с линейной
 * семантикой: возврат к BACK_TO с бюджетом попыток). Фазы публикуют
 * pipeline.phase, терминальные — pipeline.done/failed/cancelled; состояние
 * пишется в store. Активные раны трекаются в running и останавливаются
 * через stop() — ожидание сессии в исполнителе абортится сигналом.
 */
export class ModulePipeline {
  private readonly maxAttempts: number;
  private readonly fallback: IModuleWorker = new GeneralModuleWorker();
  private readonly running = new Map<string, AbortController>();
  private readonly graphs = new Map<string, INode<IPipelineData>>();
  private readonly runner = new DepthFirstNodeRunner();

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
    this.bus.publish({ type: "pipeline.started", runId, workflow: "module", task, action, domain });
    const stopper = new AbortController();
    this.running.set(runId, stopper);
    try {
      const worker = this.pickWorker(domain, action);
      const entry = this.graphFor(action, worker);
      const ctx = new MapNodeContext<IPipelineData>(runId, stopper.signal, {
        task,
        workflow: "module",
        action,
        domain,
        phase: ACTION_PHASES[action][0] ?? "spec",
        attempts: 0,
      });
      try {
        await this.runner.run(entry, ctx);
      } catch (err) {
        if (stopper.signal.aborted) return this.cancel(ctx);
        return this.fail(ctx, runId, String(err));
      }
      return this.toState(ctx.data, runId);
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

  private graphFor(action: ModuleAction, worker: IModuleWorker): INode<IPipelineData> {
    const key = `${action}:${worker.id}`;
    const cached = this.graphs.get(key);
    if (cached) return cached;
    const entry = new NodeGraphBuilder().build<IPipelineData>(this.specsFor(action, worker)).nodes.get(
      ACTION_PHASES[action][0] ?? "done"
    ) as INode<IPipelineData>;
    this.graphs.set(key, entry);
    return entry;
  }

  private specsFor(action: ModuleAction, worker: IModuleWorker): ReadonlyArray<{
    id: string;
    executor: INodeExecutor<IPipelineData>;
    outgoing: readonly string[];
    condition?: (ctx: INodeContext<IPipelineData>) => boolean;
  }> {
    const phases = ACTION_PHASES[action];
    const specs = phases.map((phase, index) => ({
      id: phase,
      executor: this.phaseExecutor(phase, worker, action),
      outgoing: [index + 1 < phases.length ? phases[index + 1]! : "verdict"],
    }));
    const last = phases[phases.length - 1]!;
    if (last === "verification") {
      return [
        ...specs,
        {
          id: "verdict",
          executor: passThrough,
          outgoing: ["retry", "fail", "done"],
        },
        {
          id: "retry",
          executor: this.retryExecutor(),
          outgoing: [BACK_TO[action] ?? "tests"],
          condition: (ctx) => ctx.data.pass === false && ctx.data.attempts + 1 < this.maxAttempts,
        },
        {
          id: "fail",
          executor: this.failExecutor(),
          outgoing: [],
          condition: (ctx) => ctx.data.pass === false && ctx.data.attempts + 1 >= this.maxAttempts,
        },
        {
          id: "done",
          executor: this.doneExecutor(),
          outgoing: [],
          condition: (ctx) => ctx.data.pass === true,
        },
      ];
    }
    return [
      ...specs.map((spec) =>
        spec.outgoing[0] === "verdict" ? { ...spec, outgoing: ["done"] } : spec
      ),
      { id: "done", executor: this.doneExecutor(), outgoing: [] },
    ];
  }

  private phaseExecutor(phase: PipelinePhase, worker: IModuleWorker, action: ModuleAction): INodeExecutor<IPipelineData> {
    return {
      run: async (ctx: INodeContext<IPipelineData>): Promise<INodeContext<IPipelineData>> => {
        if (ctx.signal.aborted) throw new Error("run stopped");
        ctx.data.phase = phase;
        await this.persist(ctx.data, ctx.runId);
        try {
          const result = await this.executor.runSession({
            agent: worker.agentFor(action, phase),
            sessionTitle: `${ctx.data.task.title} — ${phase}`,
            prompt: worker.promptFor(action, phase, ctx.data.task),
            signal: ctx.signal,
          });
          if (phase === "verification") {
            ctx.data.pass = worker.verify(result.text);
            ctx.data.error = undefined;
          }
        } catch (err) {
          if (phase === "verification") {
            const error = String(err);
            console.warn(`[pipeline] phase ${phase} error: ${error}`);
            ctx.data.pass = false;
            ctx.data.error = error;
          } else {
            throw err;
          }
        }
        return ctx;
      },
    };
  }

  private retryExecutor(): INodeExecutor<IPipelineData> {
    return {
      run: async (ctx) => {
        ctx.data.attempts += 1;
        return ctx;
      },
    };
  }

  private failExecutor(): INodeExecutor<IPipelineData> {
    return {
      run: async (ctx) => {
        ctx.data.phase = "failed";
        ctx.data.error = ctx.data.error ?? `verification failed after ${ctx.data.attempts + 1} attempt(s)`;
        await this.saveState(ctx.data, ctx.runId);
        this.bus.publish({ type: "pipeline.failed", runId: ctx.runId, error: ctx.data.error });
        return ctx;
      },
    };
  }

  private doneExecutor(): INodeExecutor<IPipelineData> {
    return {
      run: async (ctx) => {
        ctx.data.phase = "done";
        ctx.data.error = undefined;
        await this.saveState(ctx.data, ctx.runId);
        this.bus.publish({ type: "pipeline.done", runId: ctx.runId });
        return ctx;
      },
    };
  }

  private toState(data: IPipelineData, runId: string): IPipelineState {
    return {
      runId,
      phase: data.phase,
      externalId: data.task.externalId,
      source: data.task.source,
      attempts: data.attempts,
      workflow: data.workflow,
      action: data.action,
      error: data.error,
    };
  }

  private persist(data: IPipelineData, runId: string): Promise<void> {
    const state = this.toState(data, runId);
    return this.saveState(data, runId).then(() => {
      this.bus.publish({ type: "pipeline.phase", runId, phase: state.phase });
    });
  }

  private saveState(data: IPipelineData, runId: string): Promise<void> {
    return this.store.save(this.toState(data, runId));
  }

  private async cancel(ctx: INodeContext<IPipelineData>): Promise<IPipelineState> {
    ctx.data.phase = "cancelled";
    ctx.data.error = undefined;
    const state = this.toState(ctx.data, ctx.runId);
    await this.store.save(state);
    this.bus.publish({ type: "pipeline.cancelled", runId: ctx.runId });
    return state;
  }

  private async fail(ctx: INodeContext<IPipelineData>, runId: string, error: string): Promise<IPipelineState> {
    ctx.data.phase = "failed";
    ctx.data.error = error;
    const state = this.toState(ctx.data, runId);
    await this.store.save(state);
    this.bus.publish({ type: "pipeline.failed", runId, error });
    return state;
  }

  private pickWorker(domain: ModuleDomain, action: ModuleAction): IModuleWorker {
    return this.registry.resolve(domain, action)[0] ?? this.fallback;
  }
}

const passThrough: INodeExecutor<IPipelineData> = {
  run: async (ctx) => ctx,
};