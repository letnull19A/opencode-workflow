import type { IWorkflowTask } from "./task.ts";
import type { INode, INodeContext } from "./node.ts";

export type WebhookProvider = "github" | "generic" | "trello";

/**
 * Динамическая привязка вебхука: внешнее событие биндится на workflow
 * (workflow) либо на пресет action/domain модульного пайплайна, либо
 * резолвится через meta. Секрет хранится ссылкой на имя env-переменной —
 * значений в сторе нет.
 */
export interface IWebhookBinding {
  readonly id: string;
  readonly source: string;
  readonly provider: WebhookProvider;
  readonly workflow?: string;
  readonly action?: string;
  readonly domain?: string;
  readonly secretEnv?: string;
  readonly enabled: boolean;
  readonly createdAt: string;
}

export interface IWebhookStore {
  save(binding: IWebhookBinding): Promise<void>;
  load(id: string): Promise<IWebhookBinding | null>;
  list(): Promise<IWebhookBinding[]>;
  remove(id: string): Promise<void>;
}

export type WebhookFilterResult =
  | {
      readonly accepted: true;
      readonly task: IWorkflowTask;
      readonly kind: "received" | "moved";
      readonly fromList?: string;
      readonly toList?: string;
    }
  | { readonly accepted: false; readonly reason: string };

/** Маппер провайдера: сырой payload вебхука → нормализованная задача. */
export interface IWebhookProvider {
  readonly name: WebhookProvider;
  toTask(binding: IWebhookBinding, payload: unknown, headers: Readonly<Record<string, string>>): WebhookFilterResult;
}

export interface IWebhookContext {
  readonly binding: IWebhookBinding;
  readonly payload: unknown;
  readonly headers: Readonly<Record<string, string>>;
}

/** Конверт, который HTTP-слой передаёт entrypoint'у вебхука. */
export interface IWebhookEnvelope {
  readonly payload: unknown;
  readonly headers: Readonly<Record<string, string>>;
  readonly deliveryId?: string;
}

/** Стартер workflow из нормализованной задачи. null — задача отклонена. */
export interface IWorkflowStarter<TData = Record<string, unknown>> {
  start(task: IWorkflowTask, binding: IWebhookBinding): Promise<{
    context: INodeContext<TData>;
    entry: INode<TData>;
  } | null>;
}