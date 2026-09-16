import type {
  IAgentExecutor,
  ICommandExecutor,
  IVault,
  IWorkflowDefinition,
  IWorkflowRuntime,
  IWorkflowTask,
} from "@opencode-workflow/sdk";
import type { IEventBus } from "../core/events.ts";
import type { IPipelineStateStore } from "../core/pipeline.ts";
import type { ILogger } from "../core/logging.ts";
import type { IWorkflowHandle } from "../core/workflows.ts";
import { MapNodeContext } from "../engine/MapNodeContext.ts";
import { NodeGraphBuilder } from "../engine/NodeGraphBuilder.ts";
import { DepthFirstNodeRunner } from "../engine/DepthFirstNodeRunner.ts";
import { makeLogger } from "./logger.ts";

export interface GraphWorkflowServices {
  executor: IAgentExecutor;
  commands: ICommandExecutor;
  bus: IEventBus;
  store: IPipelineStateStore;
  vault: IVault;
}

/**
 * Кастомная workflow: определение (SDK IWorkflowDefinition) → IWorkflowHandle.
 * Платформа материализует спеки своим движком (NodeGraphBuilder +
 * DepthFirstNodeRunner), держит раны в running и стоп через сигнал.
 * События: pipeline.started/done/failed/cancelled; состояние в store.
 */
export class GraphWorkflow<TData = Record<string, unknown>> implements IWorkflowHandle {
  readonly id: string;
  readonly label: string;
  readonly phases?: readonly string[];
  private readonly running = new Map<string, AbortController>();
  private readonly runner: DepthFirstNodeRunner;
  private readonly log: ILogger;

  constructor(
    private readonly def: IWorkflowDefinition<TData>,
    private readonly services: GraphWorkflowServices,
    log: ILogger = makeLogger("workflow")
  ) {
    this.id = def.id;
    this.label = def.label;
    this.phases = def.phases;
    this.log = log;
    this.runner = new DepthFirstNodeRunner(log.debug);
  }

  async start(task: IWorkflowTask): Promise<string> {
    const runId = `run-${task.source}-${task.externalId}`;
    if (this.running.has(runId)) return runId;
    const stopper = new AbortController();
    this.running.set(runId, stopper);
    this.services.bus.publish({ type: "pipeline.started", runId, workflow: this.id, task });
    await this.save(task, runId, "spec");
    void this.dispatch(runId, stopper, task);
    return runId;
  }

  stop(runId: string): boolean {
    const stopper = this.running.get(runId);
    if (!stopper) return false;
    stopper.abort();
    return true;
  }

  private async dispatch(runId: string, stopper: AbortController, task: IWorkflowTask): Promise<void> {
    const { bus } = this.services;
    const startedAt = performance.now();
    try {
      this.log.info(`${this.id} run ${runId} started (task "${task.title}")`);
      const rt: IWorkflowRuntime = {
        executor: this.services.executor,
        commands: this.services.commands,
        bus: this.services.bus as unknown as IWorkflowRuntime["bus"],
        vault: this.services.vault,
      };
      const spec = await this.def.create(rt);
      const entry = new NodeGraphBuilder().build(spec.specs).nodes.get(spec.entryId);
      if (!entry) throw new Error(`workflow "${this.id}": no entry node "${spec.entryId}"`);
      const ctx = new MapNodeContext<TData>(runId, stopper.signal, this.def.seed(task));
      await this.runner.run(entry, ctx);
      await this.save(task, runId, "done");
      bus.publish({ type: "pipeline.done", runId });
      this.log.info(`${this.id} run ${runId} done (${Math.round(performance.now() - startedAt)}ms)`);
    } catch (err) {
      if (stopper.signal.aborted) {
        await this.save(task, runId, "cancelled");
        bus.publish({ type: "pipeline.cancelled", runId });
        this.log.info(`${this.id} run ${runId} cancelled by signal`);
        return;
      }
      const error = String(err);
      await this.save(task, runId, "failed", error);
      bus.publish({ type: "pipeline.failed", runId, error });
      this.log.error(`${this.id} run ${runId} failed (${Math.round(performance.now() - startedAt)}ms): ${error}`);
    } finally {
      this.running.delete(runId);
    }
  }

  private save(task: IWorkflowTask, runId: string, phase: "spec" | "done" | "failed" | "cancelled", error?: string): Promise<void> {
    return this.services.store.save({
      runId,
      phase,
      externalId: task.externalId,
      source: task.source,
      attempts: 0,
      workflow: this.id,
      ...(error ? { error } : {}),
    });
  }
}