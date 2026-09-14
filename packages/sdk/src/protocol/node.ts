import type { ICommandExecutor } from "./command.ts";

/**
 * Модель графа нод (протокол): INode — узел со связями incoming/outgoing,
 * опциональным condition-гардом и исполнителем. IEntrypointNode — точка
 * входа без incoming: workflow начинается с неё. INodeContext<TData> —
 * конверт прогона (runId, signal) + строго типизированный payload.
 * Движок (билдер/раннер) — реализация на стороне платформы, не в SDK.
 */

export interface INodeContext<TData = Record<string, unknown>> {
  readonly runId: string;
  readonly signal: AbortSignal;
  data: TData;
}

export interface INodeExecutor<TData = Record<string, unknown>> {
  run(ctx: INodeContext<TData>): Promise<INodeContext<TData>>;
}

export interface INode<TData = Record<string, unknown>> {
  readonly id: string;
  readonly executor: INodeExecutor<TData>;
  readonly incoming: readonly INode<TData>[];
  readonly outgoing: readonly INode<TData>[];
  readonly condition?: (ctx: INodeContext<TData>) => boolean | Promise<boolean>;
}

/**
 * Спек ноды: outgoing — id, резолвится в ссылки билдером платформы.
 * Билдер выводит incoming отдельным проходом (зеркало всех outgoing).
 */
export interface INodeSpec<TData> {
  readonly id: string;
  readonly executor: INodeExecutor<TData>;
  readonly outgoing: readonly string[];
  readonly condition?: (ctx: INodeContext<TData>) => boolean | Promise<boolean>;
}

export interface INodeGraph<TData> {
  readonly nodes: ReadonlyMap<string, INode<TData>>;
}

/**
 * Точка входа: внешнее событие → начальный контекст + входная нода workflow.
 * null означает «событие проигнорировано» (нет стартового узла для события).
 */
export interface IEntrypointNode<TData> {
  readonly id: string;
  start(event: unknown): Promise<{ context: INodeContext<TData>; entry: INode<TData> } | null>;
}

export interface INodeRunnerOptions {
  maxVisits?: number;
}

export interface INodeRunner {
  run<TData>(entry: INode<TData>, ctx: INodeContext<TData>, opts?: INodeRunnerOptions): Promise<INodeContext<TData>>;
  trigger<TData>(
    entrypoint: IEntrypointNode<TData>,
    event: unknown,
    opts?: INodeRunnerOptions
  ): Promise<{ started: boolean; context?: INodeContext<TData> }>;
}

export interface IGraphBuilder {
  build<TData>(specs: readonly INodeSpec<TData>[]): INodeGraph<TData>;
}

/**
 * Исполнитель ноды с доступом к командному слою: INodeExecutor, которому
 * нужны сервисы, принимает ICommandExecutor.
 */
export interface ICommandAwareNodeExecutor<TData = Record<string, unknown>>
  extends INodeExecutor<TData> {
  readonly commands: ICommandExecutor;
}