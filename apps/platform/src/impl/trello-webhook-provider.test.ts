import { describe, expect, test } from "bun:test";
import { TrelloWebhookProvider } from "./providers/TrelloWebhookProvider.ts";
import type { IWebhookBinding } from "@opencode-workflow/sdk";

const binding: IWebhookBinding = {
  id: "hk_test",
  source: "trello",
  provider: "trello",
  enabled: true,
  createdAt: new Date().toISOString(),
};

const provider = new TrelloWebhookProvider();

describe("TrelloWebhookProvider", () => {
  test("createCard → kind received", () => {
    const result = provider.toTask(binding, {
      action: {
        type: "createCard",
        date: "2026-09-15T10:00:00.000Z",
        data: {
          card: { id: "c1", name: "Демо", desc: "описание", url: "https://trello.com/c/abc", labels: [{ name: "p1" }] },
        },
      },
    }, {});
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.kind).toBe("received");
      expect(result.task.externalId).toBe("c1");
      expect(result.task.title).toBe("Демо");
      expect(result.task.labels).toEqual(["p1"]);
      expect(result.task.createdAt).toBe("2026-09-15T10:00:00.000Z");
    }
  });

  test("updateCard со сменой листа → kind moved с fromList/toList", () => {
    const result = provider.toTask(binding, {
      action: {
        type: "updateCard",
        data: {
          card: { id: "c2", name: "Фича" },
          listBefore: { id: "l1", name: "Backlog" },
          listAfter: { id: "l2", name: "This Week" },
        },
      },
    }, {});
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.kind).toBe("moved");
      expect(result.fromList).toBe("Backlog");
      expect(result.toList).toBe("This Week");
    }
  });

  test("updateCard без смены листа → rejected", () => {
    const result = provider.toTask(binding, {
      action: { type: "updateCard", data: { card: { id: "c3", name: "x" } } },
    }, {});
    expect(result.accepted).toBe(false);
  });

  test("updateCard с одинаковым до/после → rejected", () => {
    const result = provider.toTask(binding, {
      action: {
        type: "updateCard",
        data: {
          card: { id: "c4", name: "x" },
          listBefore: { id: "l1", name: "Backlog" },
          listAfter: { id: "l1", name: "Backlog" },
        },
      },
    }, {});
    expect(result.accepted).toBe(false);
  });

  test("addLabelToCard → kind received с лейблом из события", () => {
    const result = provider.toTask(binding, {
      action: {
        type: "addLabelToCard",
        date: "2026-09-16T00:00:00.000Z",
        data: {
          card: { id: "c6", name: "titled", shortLink: "abc123" },
          label: { id: "l9", name: "speka-click/infrastructure", color: "green" },
        },
      },
    }, {});
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.kind).toBe("received");
    expect(result.task.labels).toEqual(["speka-click/infrastructure"]);
    expect(result.task.url).toBe("https://trello.com/c/abc123");
  });

  test("addLabelToCard без имени лейбла → rejected", () => {
    const result = provider.toTask(binding, {
      action: { type: "addLabelToCard", data: { card: { id: "c6", name: "x" }, label: { id: "l9" } } },
    }, {});
    expect(result.accepted).toBe(false);
  });

  test("прочие action (addLabel, commentCard, deleteCard) → rejected", () => {
    for (const type of ["addLabel", "commentCard", "deleteCard", "updateList"]) {
      const result = provider.toTask(binding, {
        action: { type, data: { card: { id: "c5", name: "x" } } },
      }, {});
      expect(result.accepted).toBe(false);
    }
  });

  test("payload без card → rejected", () => {
    expect(provider.toTask(binding, { action: { type: "createCard", data: {} } }, {}).accepted).toBe(false);
  });
});