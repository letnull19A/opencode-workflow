import { defineWorkflow, graph, node, opencodeCreateSession, opencodeSessionPrompt } from "@opencode-workflow/sdk";
import type { CommandResult, IWorkflowRuntime, IWorkflowTask, SessionData } from "@opencode-workflow/sdk";

const BOARD_NAME = "Aleksei — Work Hub";
const LIST_NAME = "This Week";
const MAX_TG = 3500;

interface WeekCard {
  id: string;
  name: string;
}

interface WeekPlanData extends SessionData {
  task: IWorkflowTask;
  cards: WeekCard[];
  send: CommandResult;
}

async function cmd(
  rt: IWorkflowRuntime,
  service: string,
  op: string,
  params: Record<string, unknown>,
  signal?: AbortSignal
): Promise<unknown> {
  const res = await rt.commands.execute({ service, op, params }, signal);
  if (!res.ok) throw new Error(`${service}.${op} failed: ${res.error}`);
  return res.data;
}

/**
 * Демо: задачи из Trello-списка «This Week» → план реализации от агента
 * `plan` в одной opencode-сессии → план в Telegram.
 * Ручной запуск: POST /workflow/trello-week-plan { "title": "..." }.
 */
export default defineWorkflow<WeekPlanData>({
  id: "trello-week-plan",
  label: "Trello This Week → plan → Telegram",
  phases: ["fetch", "create", "plan", "notify"],
  seed: (task) => ({ task, cards: [], send: { ok: false, error: "not sent" } }),
  create: (rt: IWorkflowRuntime) =>
    graph<WeekPlanData>("fetch", [
      node<WeekPlanData>(
        "fetch",
        {
          run: async (ctx) => {
            const boards = (await cmd(rt, "trello", "boards.list", {}, ctx.signal)) as Array<{
              id: string;
              name?: string;
            }>;
            const board = boards.find((b) => b.name === BOARD_NAME) ?? boards[0];
            if (!board) throw new Error(`доска "${BOARD_NAME}" не найдена`);
            const lists = (await cmd(rt, "trello", "lists.list", { boardId: board.id }, ctx.signal)) as Array<{
              id: string;
              name?: string;
            }>;
            const list = lists.find((l) => l.name === LIST_NAME);
            if (!list) throw new Error(`список "${LIST_NAME}" не найден на доске "${board.name}"`);
            const cards = (await cmd(rt, "trello", "cards.list", { listId: list.id }, ctx.signal)) as Array<{
              id: string;
              name?: string;
            }>;
            ctx.data.cards = (cards ?? []).map((c) => ({ id: c.id, name: c.name ?? c.id }));
            if (!ctx.data.cards.length) throw new Error(`список "${LIST_NAME}" пуст — планировать нечего`);
            return ctx;
          },
        },
        { outgoing: ["create"] }
      ),
      opencodeCreateSession<WeekPlanData>(rt, "create", {
        title: "week plan",
        outgoing: ["plan"],
      }),
      opencodeSessionPrompt<WeekPlanData>(rt, "plan", {
        agent: "plan",
        prompt: (ctx) =>
          `Вот задачи из Trello-списка «${LIST_NAME}»:\n` +
          ctx.data.cards.map((c, i) => `${i + 1}. ${c.name}`).join("\n") +
          `\nРаспланируй реализацию по шагам: порядок, зависимости, что можно параллелить. Только текст, без записи файлов.`,
        outgoing: ["notify"],
      }),
      node<WeekPlanData>(
        "notify",
        {
          run: async (ctx) => {
            const text = ctx.data.opencode?.text?.trim() || "(агент вернул пустой план)";
            const token = await rt.vault.get("trello-week-plan", "TELEGRAM_BOT_TOKEN").catch(() => "");
            const send = await rt.commands.execute({
              service: "telegram",
              op: "messages.send",
              params: {
                text: `План на неделю (${ctx.data.cards.length} задач):\n\n${text.slice(0, MAX_TG)}`,
                ...(token ? { token } : {}),
              },
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
