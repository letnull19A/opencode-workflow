import {
  defineWorkflow,
  graph,
  opencodeCreateSession,
  opencodeSessionHistory,
  opencodeSessionPrompt,
  projectMap,
} from "@opencode-workflow/sdk";
import type {
  CommandResult,
  IWorkflowRuntime,
  IWorkflowTask,
  ProjectData,
  SessionData,
  SessionHistoryData,
} from "@opencode-workflow/sdk";

const MAX_TG = 3500;
const HISTORY_LIMIT = 5;

interface ProjectPlanData extends SessionData, ProjectData, SessionHistoryData {
  task: IWorkflowTask;
  send: CommandResult;
}

const hasProject = (ctx: { data: ProjectPlanData }): boolean => Boolean(ctx.data.project);

/**
 * Демо: Map-нода резолвит проект по лейблам карточки (явная таблица
 * лейбл → директория, STATE_DIR/projects.json); немапленные задачи тихо
 * пропускаются condition-гейтом. Сессия создаётся в директории проекта,
 * агент `plan` видит заголовки недавних сессий, план уходит в Telegram
 * вместе со списком истории.
 * Ручной запуск: POST /workflow/trello-project-plan { "title": "..." }.
 */
export default defineWorkflow<ProjectPlanData>({
  id: "trello-project-plan",
  label: "Trello label → project → plan → Telegram",
  phases: ["map", "history", "create", "plan", "notify"],
  seed: (task) => ({ task, send: { ok: false, error: "not sent" } }),
  create: (rt: IWorkflowRuntime) =>
    graph<ProjectPlanData>("map", [
      projectMap<ProjectPlanData>(rt, "map", { outgoing: ["history"] }),
      opencodeSessionHistory<ProjectPlanData>(rt, "history", {
        directory: (ctx) => ctx.data.project?.directory,
        limit: HISTORY_LIMIT,
        outgoing: ["create"],
        condition: hasProject,
      }),
      opencodeCreateSession<ProjectPlanData>(rt, "create", {
        title: (ctx) => `project plan: ${ctx.data.task.title}`,
        directory: (ctx) => ctx.data.project?.directory,
        outgoing: ["plan"],
        condition: hasProject,
      }),
      opencodeSessionPrompt<ProjectPlanData>(rt, "plan", {
        agent: "plan",
        directory: (ctx) => ctx.data.project?.directory,
        prompt: (ctx) => {
          const history = (ctx.data.opencodeSessions ?? [])
            .map((s, i) => `${i + 1}. ${s.title || s.sessionId}`)
            .join("\n");
          return (
            `Проект: ${ctx.data.project?.label}. Задача из Trello: "${ctx.data.task.title}"` +
            (ctx.data.task.description ? `\nОписание: ${ctx.data.task.description}` : "") +
            (history ? `\nНедавние сессии проекта (контекст прошлой работы):\n${history}` : "") +
            `\nРаспланируй реализацию по шагам. Только текст, без записи файлов.`
          );
        },
        outgoing: ["notify"],
        condition: hasProject,
      }),
      {
        id: "notify",
        executor: {
          run: async (ctx) => {
            const text = ctx.data.opencode?.text?.trim() || "(агент вернул пустой план)";
            const sessions = (ctx.data.opencodeSessions ?? [])
              .map((s) => `• ${s.title || s.sessionId}`)
              .join("\n");
            const token = await rt.vault.get("trello-project-plan", "TELEGRAM_BOT_TOKEN").catch(() => "");
            const send = await rt.commands.execute({
              service: "telegram",
              op: "messages.send",
              params: {
                text:
                  `План [${ctx.data.project?.label}]: ${ctx.data.task.title}\n\n${text.slice(0, MAX_TG)}` +
                  (sessions ? `\n\nНедавние сессии:\n${sessions}` : ""),
                ...(token ? { token } : {}),
              },
            });
            if (!send.ok) throw new Error(`telegram send failed: ${send.error}`);
            ctx.data.send = send;
            return ctx;
          },
        },
        outgoing: [],
        condition: hasProject,
      },
    ]),
});
