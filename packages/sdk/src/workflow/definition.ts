import type { IWorkflowTask } from "../protocol/task.ts";
import type { INodeSpec } from "../protocol/node.ts";
import type { IAgentExecutor } from "../protocol/executor.ts";
import type { ICommandExecutor } from "../protocol/command.ts";
import type { IEventBus } from "../protocol/events.ts";
import type { IVault } from "../protocol/vault.ts";

/**
 * Спецификация графа workflow — данные. Движок (билдер/раннер) находится
 * на платформе: SDK описывает, платформа исполняет.
 */
export interface IWorkflowGraph<TData> {
  readonly entryId: string;
  readonly specs: readonly INodeSpec<TData>[];
}

/**
 * Сервисы рантайма, которые платформа инжектит в create(). Workflow-автор
 * не конструирует executor/commands сам — он их получает.
 */
export interface IWorkflowRuntime {
  readonly executor: IAgentExecutor;
  readonly commands: ICommandExecutor;
  readonly bus: IEventBus<unknown>;
  readonly vault: IVault;
}

/**
 * Кастомный workflow: id/label/phases (для манифеста и дашборда),
 * seed — начальные данные прогона, create — спецификация графа.
 * Типы проверяются на build-этапе (build-workflow), не в рантайме.
 */
export interface IWorkflowDefinition<TData = Record<string, unknown>> {
  readonly id: string;
  readonly label: string;
  readonly phases?: readonly string[];
  readonly seed: (task: IWorkflowTask) => TData;
  readonly create: (
    rt: IWorkflowRuntime
  ) => IWorkflowGraph<TData> | Promise<IWorkflowGraph<TData>>;
}

export function defineWorkflow<TData>(def: IWorkflowDefinition<TData>): IWorkflowDefinition<TData> {
  return def;
}