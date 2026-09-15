import type { CommandResult, ICommand, IServiceConnector } from "@opencode-workflow/sdk";

const TELEGRAM_API = "https://api.telegram.org";

/**
 * Коннектор Telegram: отправка сообщений через Bot API. Секреты — только из
 * env (TELEGRAM_BOT_TOKEN), целевой чат — TELEGRAM_CHAT_ID либо params.chat_id.
 * Сырой fetch — только здесь; workflow работает через ICommandExecutor.
 */
export class TelegramConnector implements IServiceConnector {
  readonly service = "telegram";

  canHandle(service: string): boolean {
    return service === this.service;
  }

  async execute(command: ICommand, signal?: AbortSignal): Promise<CommandResult> {
    try {
      switch (command.op) {
        case "messages.send":
          return await this.sendMessage(command.params, signal);
        case "chats.list":
          return await this.listChats(signal);
        default:
          return { ok: false, error: `unknown op "${command.op}"` };
      }
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  private async listChats(signal?: AbortSignal): Promise<CommandResult> {
    const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
    if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN не установлен в env" };
    const res = await fetch(`${TELEGRAM_API}/bot${token}/getUpdates?limit=100&timeout=0`, { signal });
    if (!res.ok) throw new Error(`Telegram getUpdates: HTTP ${res.status}`);
    const payload = (await res.json()) as {
      ok?: boolean;
      description?: string;
      result?: Array<{
        message?: { chat?: { id?: number; type?: string; title?: string; username?: string; first_name?: string } };
      }>;
    };
    if (payload.ok === false) throw new Error(payload.description ?? "unspecified telegram error");
    const chats = new Map<number, { id: number; type?: string; title?: string; username?: string }>();
    for (const update of payload.result ?? []) {
      const chat = update.message?.chat;
      if (!chat || chat.id === undefined) continue;
      const label = chat.title ?? chat.username ?? chat.first_name ?? chat.type ?? `chat ${chat.id}`;
      chats.set(chat.id, {
        id: chat.id,
        ...(chat.type ? { type: chat.type } : {}),
        ...(chat.title ? { title: chat.title } : { username: label }),
      });
    }
    return { ok: true, data: [...chats.values()] };
  }

  private async sendMessage(params: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<CommandResult> {
    const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
    if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN не установлен в env" };

    const text = typeof params.text === "string" ? params.text.trim() : "";
    if (!text) return { ok: false, error: 'для "messages.send" обязателен params.text' };

    const chatId = typeof params.chat_id === "string" && params.chat_id
      ? params.chat_id
      : process.env.TELEGRAM_CHAT_ID ?? "";
    if (!chatId) return { ok: false, error: "chat не указан: TELEGRAM_CHAT_ID в env или params.chat_id" };

    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal,
    });
    if (!res.ok) throw new Error(`Telegram sendMessage: HTTP ${res.status}`);
    const data = (await res.json()) as { ok?: boolean; description?: string };
    if (data.ok === false) throw new Error(data.description ?? "unspecified telegram error");
    return { ok: true, data };
  }
}