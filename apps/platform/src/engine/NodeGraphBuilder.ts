import type {
  IGraphBuilder,
  INode,
  INodeContext,
  INodeExecutor,
  INodeGraph,
  INodeSpec,
} from "@opencode-workflow/sdk";

class GraphNode<TData> implements INode<TData> {
  readonly incoming: INode<TData>[] = [];
  readonly outgoing: INode<TData>[] = [];
  constructor(
    readonly id: string,
    readonly executor: INodeExecutor<TData>,
    readonly condition?: (ctx: INodeContext<TData>) => boolean | Promise<boolean>
  ) {}
}

/**
 * Сборка графа из спек за четыре прохода: валидация (уникальные id,
 * существующие outgoing, запрет self-loop), инстанцирование, резолв outgoing,
 * вывод incoming — точное зеркало всех outgoing, руками не пишется.
 */
export class NodeGraphBuilder implements IGraphBuilder {
  build<TData>(specs: readonly INodeSpec<TData>[]): INodeGraph<TData> {
    this.validate(specs);
    const nodes = new Map<string, GraphNode<TData>>();
    for (const spec of specs) nodes.set(spec.id, new GraphNode(spec.id, spec.executor, spec.condition));

    for (const spec of specs) {
      const node = nodes.get(spec.id) as GraphNode<TData>;
      for (const targetId of spec.outgoing) {
        const target = nodes.get(targetId) as GraphNode<TData>;
        node.outgoing.push(target);
        target.incoming.push(node);
      }
    }

    return { nodes };
  }

  private validate<TData>(specs: readonly INodeSpec<TData>[]): void {
    const ids = new Set<string>();
    for (const spec of specs) {
      if (!spec.id) throw new Error("node spec requires a non-empty id");
      if (ids.has(spec.id)) throw new Error(`duplicate node id "${spec.id}"`);
      ids.add(spec.id);
    }
    for (const spec of specs) {
      for (const targetId of spec.outgoing) {
        if (!ids.has(targetId)) {
          throw new Error(`node "${spec.id}" references unknown outgoing "${targetId}"`);
        }
        if (targetId === spec.id) {
          throw new Error(`node "${spec.id}" cannot link to itself`);
        }
      }
    }
  }
}