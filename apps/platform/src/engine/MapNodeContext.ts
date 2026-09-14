import type { INodeContext } from "@opencode-workflow/sdk";

/** Контекст прогона на базе Map: конверт runId/signal + типизированные данные. */
export class MapNodeContext<TData = Record<string, unknown>> implements INodeContext<TData> {
  constructor(
    readonly runId: string,
    readonly signal: AbortSignal,
    public data: TData
  ) {}
}