import type { IWebhookBinding, IWebhookProvider, WebhookFilterResult } from "@opencode-workflow/sdk";
import type { IWorkflowTask } from "@opencode-workflow/sdk";

/**
 * Провайдер generic: тело уже в форме IWorkflowTask; source и старт workflow
 * берутся из биндинга; action/domain — из тела или биндинга.
 */
export class GenericWebhookProvider implements IWebhookProvider {
  readonly name = "generic" as const;

  toTask(binding: IWebhookBinding, payload: unknown, _headers: Readonly<Record<string, string>>): WebhookFilterResult {
    const partial = payload as Partial<IWorkflowTask> | undefined;
    if (!partial || typeof partial !== "object") return { accepted: false, reason: "payload не объект" };
    const externalId = typeof partial.externalId === "string" ? partial.externalId : "";
    const title = typeof partial.title === "string" ? partial.title : "";
    if (!externalId && !title) return { accepted: false, reason: "нет externalId/title" };
    const meta: Record<string, unknown> = {
      ...(partial.meta as Readonly<Record<string, unknown>> | undefined),
      ...(binding.action ? { action: binding.action } : {}),
      ...(binding.domain ? { domain: binding.domain } : {}),
    };
    const task: IWorkflowTask = {
      externalId: externalId || `generic-${Date.now()}`,
      source: binding.source,
      title,
      description: partial.description,
      url: partial.url,
      labels: partial.labels,
      attachments: partial.attachments,
      createdAt: partial.createdAt ?? new Date().toISOString(),
      meta: Object.keys(meta).length ? meta : undefined,
    };
    return { accepted: true, task };
  }
}