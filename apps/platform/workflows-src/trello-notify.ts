import { defineWorkflow, graph, node } from "@opencode-workflow/sdk";
import type { CommandResult, IWorkflowRuntime, IWorkflowTask } from "@opencode-workflow/sdk";

/**
 * Пример «реактор» на задачи: реагирует на task.received (запускается
 * платформой через WorkflowTaskRouter, WORKFLOW_ON_TASK_RECEIVED=trello-notify)
 * и отправляет уведомление в Telegram (TelegramConnector, service "telegram").
 */
interface NotifyData {
  task: IWorkflowTask;
  send: CommandResult;
}

function format(task: IWorkflowTask): string {
  const labels = task.labels?.length ? ` [${task.labels.join(", ")}]` : "";
  const url = task.url ?? `https://trello.com/c/${task.externalId}`;
  const desc = task.description ? `\n${task.description.slice(0, 200)}` : "";
  return `Новая задача: ${task.title}${labels}${desc}\n${url}`;
}

export default defineWorkflow<NotifyData>({
  id: "trello-notify",
  label: "Trello → Telegram",
  phases: ["notify"],
  seed: (task) => ({ task, send: { ok: false, error: "not sent" } }),
  create: (rt: IWorkflowRuntime) =>
    graph<NotifyData>("notify", [
      node<NotifyData>(
        "notify",
        {
          run: async (ctx) => {
            const token = await rt.vault.get("trello-notify", "TELEGRAM_BOT_TOKEN").catch(() => "");
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