import type { IAgentExecutor } from "../core/executor.ts";
import type { INodeContext, INodeExecutor } from "../core/node.ts";
import type { PromptSessionResult } from "../core/types.ts";

/** Данные прогона агентской ноды: вход + результат сессии. */
export interface IAgentRunData {
  prompt: string;
  agent?: string;
  sessionTitle?: string;
  sessionId?: string;
  text?: string;
}

/** Мэппинг входа/выхода агентской сессии из произвольного payload ноды. */
export interface IAgentMapper<T> {
  promptOf(data: T): string;
  agentOf?(data: T): string | undefined;
  sessionTitleOf?(data: T): string | undefined;
  applyResult(data: T, result: PromptSessionResult): T;
}

export class DefaultAgentMapper<T extends IAgentRunData> implements IAgentMapper<T> {
  promptOf(data: T): string {
    return data.prompt;
  }
  agentOf(data: T): string | undefined {
    return data.agent;
  }
  sessionTitleOf(data: T): string | undefined {
    return data.sessionTitle;
  }
  applyResult(data: T, result: PromptSessionResult): T {
    return { ...data, sessionId: result.sessionId, text: result.text };
  }
}

/**
 * Адаптер: IAgentExecutor как INodeExecutor. Промпт и результат агрегатятся
 * через IAgentMapper — раннер ничего не знает про агентский транспорт.
 */
export class AgentNodeExecutor<T> implements INodeExecutor<T> {
  constructor(
    private readonly agents: IAgentExecutor,
    private readonly mapper: IAgentMapper<T>
  ) {}

  async run(ctx: INodeContext<T>): Promise<INodeContext<T>> {
    if (ctx.signal.aborted) throw new Error("run stopped");
    const result = await this.agents.runSession({
      prompt: this.mapper.promptOf(ctx.data),
      ...(this.mapper.agentOf ? { agent: this.mapper.agentOf(ctx.data) } : {}),
      ...(this.mapper.sessionTitleOf ? { sessionTitle: this.mapper.sessionTitleOf(ctx.data) } : {}),
      signal: ctx.signal,
    });
    ctx.data = this.mapper.applyResult(ctx.data, result);
    return ctx;
  }
}