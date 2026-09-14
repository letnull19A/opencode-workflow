import type { INodeExecutor, INodeSpec, INodeContext } from "../protocol/node.ts";
import type { PromptSessionResult } from "../protocol/executor.ts";
import type { IWorkflowGraph } from "../workflow/definition.ts";

export interface INodeOptions<TData> {
  readonly outgoing?: readonly string[];
  readonly condition?: (ctx: INodeContext<TData>) => boolean | Promise<boolean>;
}

/** Спека одной ноды workflow: id + исполнитель + исходящие связи + гард. */
export function node<TData>(
  id: string,
  executor: INodeExecutor<TData>,
  opts: INodeOptions<TData> = {}
): INodeSpec<TData> {
  return { id, executor, outgoing: opts.outgoing ?? [], condition: opts.condition };
}

/** Набор спеков графа workflow (данные для движка платформы). */
export function graph<TData>(entryId: string, specs: readonly INodeSpec<TData>[]): IWorkflowGraph<TData> {
  return { entryId, specs };
}

/** Прогон агента из узла: обёртка над rt.executor с сигналом отмены. */
export async function session(
  rt: { executor: { runSession(opts: { prompt: string; agent?: string; signal?: AbortSignal }): Promise<PromptSessionResult> } },
  ctx: INodeContext<unknown>,
  prompt: string,
  agent?: string
): Promise<PromptSessionResult> {
  return rt.executor.runSession({ prompt, agent, signal: ctx.signal });
}