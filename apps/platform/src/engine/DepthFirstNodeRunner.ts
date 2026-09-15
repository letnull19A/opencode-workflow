import type {
  IEntrypointNode,
  INode,
  INodeContext,
  INodeRunner,
  INodeRunnerOptions,
} from "@opencode-workflow/sdk";
import type { LogFn } from "../core/logging.ts";

const DEFAULT_MAX_VISITS = 1000;

/**
 * Depth-first раннер графа: выполняет ноду, затем всех её потомков слева
 * направо. Condition на ноде гейтит и выполнение, и поддерево: false — нода
 * и её потомки пропускаются. Ошибка исполнителя пробрасывается наверх.
 * Циклы (например verification → tests при возврате) ограничены бюджетом
 * посещений на ноду; отмена — через ctx.signal. Опциональный debug-логгер
 * пишет каждый проход ноды (id, длительность, ошибку).
 */
export class DepthFirstNodeRunner implements INodeRunner {
  private readonly debugLog: LogFn;

  constructor(debugLog: LogFn = () => {}) {
    this.debugLog = debugLog;
  }

  async run<TData>(
    entry: INode<TData>,
    ctx: INodeContext<TData>,
    opts?: INodeRunnerOptions
  ): Promise<INodeContext<TData>> {
    const budget = opts?.maxVisits ?? DEFAULT_MAX_VISITS;
    const visits = new Map<string, number>();
    await this.visit(entry, ctx, visits, budget);
    return ctx;
  }

  async trigger<TData>(
    entrypoint: IEntrypointNode<TData>,
    event: unknown,
    opts?: INodeRunnerOptions
  ): Promise<{ started: boolean; context?: INodeContext<TData> }> {
    const started = await entrypoint.start(event);
    if (!started) return { started: false };
    const context = await this.run(started.entry, started.context, opts);
    return { started: true, context };
  }

  private async visit<TData>(
    node: INode<TData>,
    ctx: INodeContext<TData>,
    visits: Map<string, number>,
    budget: number
  ): Promise<void> {
    if (ctx.signal.aborted) throw new Error("run stopped");
    const count = (visits.get(node.id) ?? 0) + 1;
    if (count > budget) {
      throw new Error(`node "${node.id}" exceeded visit budget ${budget}`);
    }
    visits.set(node.id, count);

    if (node.condition) {
      const active = await node.condition(ctx);
      this.debugLog(`node "${node.id}" condition → ${active ? "active" : "skip"}`);
      if (!active) return;
    }

    const startedAt = performance.now();
    this.debugLog(`node "${node.id}" start`);
    try {
      ctx = await node.executor.run(ctx);
    } catch (err) {
      this.debugLog(`node "${node.id}" error: ${String(err)}`);
      throw err;
    }
    this.debugLog(`node "${node.id}" done (${Math.round(performance.now() - startedAt)}ms)`);
    for (const next of node.outgoing) {
      await this.visit(next, ctx, visits, budget);
    }
  }
}