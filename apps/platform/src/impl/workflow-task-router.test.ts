import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { InMemoryEventBus } from "./InMemoryEventBus.ts";
import { parseWorkflowIds, WorkflowTaskRouter } from "./WorkflowTaskRouter.ts";
import { TelegramConnector } from "./TelegramConnector.ts";
import type { WorkflowEvent } from "../core/events.ts";
import type { IWorkflowHandle, IWorkflowRegistry } from "../core/workflows.ts";
import type { IWorkflowTask } from "@opencode-workflow/sdk";

const task: IWorkflowTask = {
  externalId: "card-1",
  source: "trello",
  title: "Пользователи",
  url: "https://trello.com/c/card-1",
  createdAt: new Date().toISOString(),
};

function fakeHandle(id: string, started: Array<{ id: string; task: IWorkflowTask }>): IWorkflowHandle {
  return {
    id,
    label: id,
    phases: ["notify"],
    start: async (t) => {
      started.push({ id, task: t });
      return `run-${id}-${t.externalId}`;
    },
    stop: () => true,
  };
}

function fakeRegistry(handles: readonly IWorkflowHandle[]): IWorkflowRegistry {
  const map = new Map(handles.map((h) => [h.id, h]));
  return {
    register: (h) => void map.set(h.id, h),
    unregister: (id) => map.delete(id),
    resolve: (id) => (id ? map.get(id) : undefined),
    list: () => [...map.values()],
  };
}

describe("parseWorkflowIds", () => {
  test("разбирает список через запятую, отбрасывает пустое", () => {
    expect(parseWorkflowIds(" trello-notify , , other ")).toEqual(["trello-notify", "other"]);
    expect(parseWorkflowIds()).toEqual([]);
    expect(parseWorkflowIds("   ")).toEqual([]);
  });
});

describe("WorkflowTaskRouter", () => {
  afterEach(() => process.env.WORKFLOW_ON_TASK_RECEIVED = "");

  test("запускает настроенную workflow на task.received", () => {
    const bus = new InMemoryEventBus();
    const started: Array<{ id: string; task: IWorkflowTask }> = [];
    const registry = fakeRegistry([fakeHandle("trello-notify", started), fakeHandle("other", started)]);
    const router = new WorkflowTaskRouter(bus, registry, { onReceived: parseWorkflowIds("trello-notify") });
    bus.publish({ type: "task.received", task });
    router.close();
    expect(started.map((s) => s.id)).toEqual(["trello-notify"]);
    expect(started[0]!.task.title).toBe(task.title);
  });

  test("запускает workflow на task.moved и передаёт meta.move", () => {
    const bus = new InMemoryEventBus();
    const started: Array<{ id: string; task: IWorkflowTask }> = [];
    const registry = fakeRegistry([fakeHandle("trello-move-notify", started)]);
    const router = new WorkflowTaskRouter(bus, registry, {
      onReceived: [],
      onMoved: parseWorkflowIds("trello-move-notify"),
    });
    bus.publish({ type: "task.moved", task, fromList: "Backlog", toList: "This Week" });
    router.close();
    expect(started.map((s) => s.id)).toEqual(["trello-move-notify"]);
    expect(started[0]!.task.meta).toEqual({ move: { fromList: "Backlog", toList: "This Week" } });
  });

  test("сообщения о перемещении не триггерят реакторы на task.received", () => {
    const bus = new InMemoryEventBus();
    const started: Array<{ id: string; task: IWorkflowTask }> = [];
    const registry = fakeRegistry([fakeHandle("trello-notify", started)]);
    const router = new WorkflowTaskRouter(bus, registry, { onReceived: parseWorkflowIds("trello-notify") });
    bus.publish({ type: "task.moved", task, fromList: "Backlog", toList: "This Week" });
    router.close();
    expect(started).toHaveLength(0);
  });

  test("игнорирует чужие события и не роняет платформу", () => {
    const bus = new InMemoryEventBus();
    const started: Array<{ id: string; task: IWorkflowTask }> = [];
    const registry = fakeRegistry([fakeHandle("trello-notify", started)]);
    const router = new WorkflowTaskRouter(bus, registry, { onReceived: parseWorkflowIds("trello-notify") });
    bus.publish({ type: "pipeline.done", runId: "run-x" } satisfies WorkflowEvent);
    router.close();
    expect(started).toHaveLength(0);
  });
});

describe("TelegramConnector", () => {
  let fetchCalls: Array<{ url: string; body: Record<string, unknown> }>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchCalls = [];
    globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {} });
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  test("шлёт сообщение в chat из env c текстом из params", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "TEST_BOT_TOKEN";
    process.env.TELEGRAM_CHAT_ID = "@workhub";
    const connector = new TelegramConnector();
    const result = await connector.execute({ service: "telegram", op: "messages.send", params: { text: "Новая задача" } });
    expect(result.ok).toBe(true);
    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0]!;
    expect(call.url).toBe("https://api.telegram.org/botTEST_BOT_TOKEN/sendMessage");
    expect(call.body).toEqual({ chat_id: "@workhub", text: "Новая задача", disable_web_page_preview: true });
  });

  test("params.chat_id имеет приоритет над env-дефолтом", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "TEST_BOT_TOKEN";
    process.env.TELEGRAM_CHAT_ID = "@default";
    const connector = new TelegramConnector();
    await connector.execute({ service: "telegram", op: "messages.send", params: { text: "x", chat_id: "@custom" } });
    const call = fetchCalls[0]!;
    expect(call.body.chat_id).toBe("@custom");
  });

  test("без токена или chat возвращает ok:false без сети", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const connector = new TelegramConnector();
    const noToken = await connector.execute({ service: "telegram", op: "messages.send", params: { text: "x" } });
    expect(noToken).toEqual({ ok: false, error: "токен не задан: params.token (vault) или TELEGRAM_BOT_TOKEN в env" });

    process.env.TELEGRAM_BOT_TOKEN = "TEST_BOT_TOKEN";
    delete process.env.TELEGRAM_CHAT_ID;
    const noChat = await connector.execute({ service: "telegram", op: "messages.send", params: { text: "x" } });
    expect(noChat.ok).toBe(false);

    const noText = await connector.execute({ service: "telegram", op: "messages.send", params: {} });
    expect(noText.ok).toBe(false);
    expect(fetchCalls).toHaveLength(0);
  });

  test("params.token (vault) имеет приоритет над env-токеном", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "ENV_TOKEN";
    process.env.TELEGRAM_CHAT_ID = "@workhub";
    const connector = new TelegramConnector();
    await connector.execute({
      service: "telegram",
      op: "messages.send",
      params: { text: "x", token: "VAULT_TOKEN" },
    });
    const call = fetchCalls[0]!;
    expect(call.url).toBe("https://api.telegram.org/botVAULT_TOKEN/sendMessage");
  });

  test("chats.list отдаёт уникальные чаты из getUpdates", async () => {
    fetchCalls = [];
    globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {} });
      const payload = url.includes("getUpdates")
        ? {
            ok: true,
            result: [
              { message: { chat: { id: 111, type: "private", username: "aleksei" } } },
              { message: { chat: { id: 111, type: "private", username: "aleksei" } } },
              { message: { chat: { id: -100, type: "supergroup", title: "Work Hub" } } },
            ],
          }
        : { ok: true, result: {} };
      return Promise.resolve(
        new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } })
      );
    }) as typeof fetch;

    process.env.TELEGRAM_BOT_TOKEN = "TEST_BOT_TOKEN";
    const connector = new TelegramConnector();
    const result = await connector.execute({ service: "telegram", op: "chats.list", params: {} });
    expect(result.ok).toBe(true);
    expect((result as { data: unknown }).data).toEqual([
      { id: 111, type: "private", username: "aleksei" },
      { id: -100, type: "supergroup", title: "Work Hub" },
    ]);
  });

  test("неизвестная операция → ok:false", async () => {
    const connector = new TelegramConnector();
    const result = await connector.execute({ service: "trello", op: "cards.list", params: {} });
    expect(result.ok).toBe(false);
  });
});