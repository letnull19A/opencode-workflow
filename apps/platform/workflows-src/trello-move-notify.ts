import { defineWorkflow, graph, node } from "@opencode-workflow/sdk";
import type { CommandResult, IWorkflowRuntime, IWorkflowTask } from "@opencode-workflow/sdk";

/** meta.move кладётся платформой: TaskWatcher (дифф поллинга) или TrelloWebhookProvider. */
interface MoveMeta {
  move?: { fromList: string; toList: string };
}

interface NotifyData {
  task: IWorkflowTask;
  send: CommandResult;
}

function format(task: IWorkflowTask): string {
  const move = (task.meta as MoveMeta | undefined)?.move;
  const url = task.url ?? `https://trello.com/c/${task.externalId}`;
  if (!move) return `Задача изменена: ${task.title}\n${url}`;
  return `Карточка переехала: "${task.title}"\n${move.fromList} → ${move.toList}\n${url}`;
}

/**
 * Реактор на task.moved: срабатывает по WORKFLOW_ON_TASK_MOVED от
 * поллинг-диффа TaskWatcher или Trello webhook (updateCard с listBefore/listAfter)
 * и отправляет уведомление в Telegram. Токен — из vault (scope = id workflow),
 * env TELEGRAM_BOT_TOKEN остаётся фоллбэком.
 */
export default defineWorkflow<NotifyData>({
  id: "trello-move-notify",
  label: "Trello move → Telegram",
  phases: ["notify"],
  seed: (task) => ({ task, send: { ok: false, error: "not sent" } }),
  create: (rt: IWorkflowRuntime) =>
    graph<NotifyData>("notify", [
      node<NotifyData>(
        "notify",
        {
          run: async (ctx) => {
            const token = await rt.vault.get("trello-move-notify", "TELEGRAM_BOT_TOKEN").catch(() => "");
            const send = await rt.commands.execute({
              service: "telegram",
              op: "messages.send",
              params: { text: format(ctx.data.task), ...(token ? { token } : {}) },
            });
            if (!send.ok) throw new Error(`telegram send failed: ${send.error}`);
            ctx.data.send = send;
            return ctx;
          },
        },
        { outgoing: [] }
      ),
    ]),
});