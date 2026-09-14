import type { IEntrypointNode, INode, INodeContext } from "../core/node.ts";
import type {
  IWebhookBinding,
  IWebhookEnvelope,
  IWebhookProvider,
  IWorkflowStarter,
} from "../core/webhook.ts";
import type { IEventBus } from "../core/events.ts";

/**
 * Entrypoint-нода вебхука: внешнее событие → задача (провайдер) → старт
 * workflow через IWorkflowStarter. Отказы провайдера публикуются в шину
 * как entrypoint.ignored — ничего не замалчиваем.
 */
export class WebhookEntrypointNode<TData> implements IEntrypointNode<TData> {
  constructor(
    readonly id: string,
    private readonly binding: IWebhookBinding,
    private readonly providers: ReadonlyMap<string, IWebhookProvider>,
    private readonly starter: IWorkflowStarter<TData>,
    private readonly bus: IEventBus
  ) {}

  async start(event: unknown): Promise<{ context: INodeContext<TData>; entry: INode<TData> } | null> {
    const envelope = event as IWebhookEnvelope | undefined;
    if (!envelope) return null;
    const provider = this.providers.get(this.binding.provider);
    if (!provider) {
      this.bus.publish({
        type: "entrypoint.ignored",
        hookId: this.binding.id,
        reason: "misconfigured",
        detail: `no provider "${this.binding.provider}"`,
      });
      return null;
    }
    const filtered = provider.toTask(this.binding, envelope.payload, envelope.headers);
    if (!filtered.accepted) {
      this.bus.publish({
        type: "entrypoint.ignored",
        hookId: this.binding.id,
        reason: "filter_mismatch",
        detail: filtered.reason,
      });
      return null;
    }
    return this.starter.start(filtered.task, this.binding);
  }
}