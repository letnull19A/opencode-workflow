import type { PromptSessionResult } from "./types.ts";

export interface IAgentExecutor {
  listAgents(): Promise<string[]>;
  runSession(opts: {
    prompt: string;
    agent?: string;
    sessionTitle?: string;
  }): Promise<PromptSessionResult>;
}
