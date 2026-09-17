import type { IWebhookBinding, IWebhookProvider, WebhookFilterResult } from "@opencode-workflow/sdk";
import type { IWorkflowTask } from "@opencode-workflow/sdk";

interface TrelloListRef {
  id?: string;
  name?: string;
}

interface TrelloActionData {
  card?: { id?: string; name?: string; desc?: string; url?: string; shortLink?: string; labels?: Array<{ name?: string }> };
  board?: { id?: string; name?: string };
  list?: TrelloListRef;
  listBefore?: TrelloListRef;
  listAfter?: TrelloListRef;
  label?: { id?: string; name?: string; color?: string };
}

interface TrelloWebhookPayload {
  action?: {
    type?: string;
    data?: TrelloActionData;
    date?: string;
  };
  model?: { id?: string; name?: string };
}

/**
 * Провайдер Trello webhook (callbackURL → POST): нормализует action в
 * IWorkflowTask. createCard → kind "received", updateCard с переездом между
 * листами (listBefore/listAfter) → kind "moved", addLabelToCard → kind
 * "received" с лейблом из события (createCard приходит без лейблов —
 * Trello навешивает их отдельным событием). Остальные action — rejected.
 */
export class TrelloWebhookProvider implements IWebhookProvider {
  readonly name = "trello" as const;

  toTask(binding: IWebhookBinding, payload: unknown, _headers: Readonly<Record<string, string>>): WebhookFilterResult {
    const action = (payload as TrelloWebhookPayload | undefined)?.action;
    const data = action?.data;
    const card = data?.card;
    if (!card?.id || !card.name) return { accepted: false, reason: "нет card id/name" };

    const type = action?.type ?? "";
    const task = this.toWorkflowTask(binding.source, card, action?.date);
    if (type === "createCard") {
      return { accepted: true, task, kind: "received" };
    }
    if (type === "updateCard") {
      const before = data?.listBefore;
      const after = data?.listAfter;
      if (before?.name && after?.name && before.id !== after.id) {
        return { accepted: true, task, kind: "moved", fromList: before.name, toList: after.name };
      }
      return { accepted: false, reason: "updateCard без изменения листа" };
    }
    if (type === "addLabelToCard") {
      const labelName = data?.label?.name;
      if (!labelName) return { accepted: false, reason: "addLabelToCard без имени лейбла" };
      const labeled = this.toWorkflowTask(binding.source, card, action?.date, [labelName]);
      return { accepted: true, task: labeled, kind: "received" };
    }
    return { accepted: false, reason: `action "${type}" не отслеживается` };
  }

  private toWorkflowTask(
    source: string,
    card: NonNullable<TrelloActionData["card"]>,
    date?: string,
    extraLabels: string[] = []
  ): IWorkflowTask {
    const names = [
      ...(card.labels?.map((l) => l.name).filter((name): name is string => !!name) ?? []),
      ...extraLabels,
    ];
    return {
      externalId: card.id ?? "",
      source,
      title: card.name ?? "",
      description: card.desc,
      url: card.url ?? (card.shortLink ? `https://trello.com/c/${card.shortLink}` : undefined),
      labels: names.length ? names : undefined,
      createdAt: date ?? new Date().toISOString(),
    };
  }
}