import type { IWorkflowTask } from "@opencode-workflow/sdk";

export interface IDeliveryRequest {
  readonly runId: string;
  readonly task: IWorkflowTask;
  readonly directory: string;
}

export interface IDeliveryResult {
  readonly runId: string;
  readonly committed: boolean;
  readonly pushed: boolean;
  readonly commit?: string;
  readonly error?: string;
}

export interface IDelivery {
  deliver(req: IDeliveryRequest, signal?: AbortSignal): Promise<IDeliveryResult>;
}