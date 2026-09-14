import type { INode, INodeContext, INodeExecutor } from "../core/node.ts";
import type { IWebhookBinding, IWorkflowStarter } from "../core/webhook.ts";
import type { IWorkflowTask } from "../core/task.ts";
import type { IPipelineData } from "../core/pipeline-data.ts";
import type { ModulePipeline } from "./ModulePipeline.ts";
import { MapNodeContext } from "./MapNodeContext.ts";
import { NodeGraphBuilder } from "./NodeGraphBuilder.ts";
import { resolveAction, resolveDomain } from "./ModuleMatcher.ts";

/**
 * Переходный стартер до миграции пайплайна на граф (F4): строит граф из
 * одной ноды, которая запускает существующий ModulePipeline из обёртки.
 * Настоящий фазовый граф придёт на смену вместе с миграцией, интерфейс
 * стартера не изменится.
 */
export class ModuleWorkflowStarter implements IWorkflowStarter<IPipelineData> {
  private readonly entry: INode<IPipelineData>;

  constructor(pipeline: ModulePipeline) {
    const kick: INodeExecutor<IPipelineData> = {
      run: async (ctx: INodeContext<IPipelineData>): Promise<INodeContext<IPipelineData>> => {
        if (ctx.signal.aborted) throw new Error("run stopped");
        void pipeline
          .start(ctx.data.task, ctx.data.domain, ctx.data.action)
          .then((state) => {
            console.log(`[webhook] ${state.runId} finished in ${state.phase}${state.error ? `: ${state.error}` : ""}`);
          })
          .catch((err) => console.error(`[webhook] ${String(err)}`));
        return ctx;
      },
    };
    this.entry = new NodeGraphBuilder().build<IPipelineData>([
      { id: "module", executor: kick, outgoing: [] },
    ]).nodes.get("module") as INode<IPipelineData>;
  }

  async start(
    task: IWorkflowTask,
    _binding: IWebhookBinding
  ): Promise<{ context: INodeContext<IPipelineData>; entry: INode<IPipelineData> } | null> {
    const runId = `run-${task.source}-${task.externalId}`;
    const context = new MapNodeContext<IPipelineData>(runId, new AbortController().signal, {
      task,
      action: resolveAction(task),
      domain: resolveDomain(task),
      phase: "spec",
      attempts: 0,
    });
    return { context, entry: this.entry };
  }
}