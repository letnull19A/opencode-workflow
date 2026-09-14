import type { IWorkflowTask } from "./task.ts";
import type { ModuleAction, ModuleDomain } from "./types.ts";
import type { INode, INodeContext } from "./node.ts";

export type WebhookProvider = "github" | "generic";

/**
 * Динамическая привязка вебхука: внешнее событие биндится на workflow
 * через action/domain (пресет) либо через meta-резолв. Секрет хранится
 * ссылкой на имя env-переменной — значения в сторе нет.
 */
export interface IWebhookBinding {
  readonly id: string;
  readonly source: string;
  readonly provider: WebhookProvider;
  readonly action?: ModuleAction;
  readonly domain?: ModuleDomain;
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
  | { readonly accepted: true; readonly task: IWorkflowTask }
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

/** Фабрика старта workflow из нормализованной задачи. null — задача отклонена. */
export interface IWorkflowStarter<TData = Record<string, unknown>> {
  start(task: IWorkflowTask, binding: IWebhookBinding): Promise<{
    context: INodeContext<TData>;
    entry: INode<TData>;
  } | null>;
}