import {
  defineWorkflow,
  graph,
  opencodeCreateSession,
  opencodeSessionPrompt,
  opencodeWorktree,
  projectMap,
} from "@opencode-workflow/sdk";
import type {
  CommandResult,
  IWorkflowRuntime,
  IWorkflowTask,
  ProjectData,
  SessionData,
  WorktreeData,
} from "@opencode-workflow/sdk";

const MAX_TG = 3500;

interface ProjectWorkData extends SessionData, ProjectData, WorktreeData {
  task: IWorkflowTask;
  send: CommandResult;
}

const hasProject = (ctx: { data: ProjectWorkData }): boolean => Boolean(ctx.data.project);
const hasWorktree = (ctx: { data: ProjectWorkData }): boolean => Boolean(ctx.data.worktree?.directory);

/**
 * Демо параллельной работы: карточка → проект (Map) → свой worktree
 * (имя = id карточки, реюз при повторе) → сессия в worktree →
 * агент `general` реализует задачу и коммитит → итог + ветка в Telegram.
 * Мержит человек. Ручной запуск: POST /workflow/trello-project-work.
 */
export default defineWorkflow<ProjectWorkData>({
  id: "trello-project-work",
  label: "Trello card → worktree → implement → Telegram",
  phases: ["map", "worktree", "create", "work", "notify"],
  seed: (task) => ({ task, send: { ok: false, error: "not sent" } }),
  create: (rt: IWorkflowRuntime) =>
    graph<ProjectWorkData>("map", [
      projectMap<ProjectWorkData>(rt, "map", { outgoing: ["worktree"] }),
      opencodeWorktree<ProjectWorkData>(rt, "worktree", {
        directory: (ctx) => ctx.data.project?.directory,
        name: (ctx) => `card-${ctx.data.task.externalId}`,
        outgoing: ["create"],
        condition: hasProject,
      }),
      opencodeCreateSession<ProjectWorkData>(rt, "create", {
        title: (ctx) => `work: ${ctx.data.task.title}`,
        directory: (ctx) => ctx.data.worktree?.directory,
        outgoing: ["work"],
        condition: hasWorktree,
      }),
      opencodeSessionPrompt<ProjectWorkData>(rt, "work", {
        agent: "general",
        directory: (ctx) => ctx.data.worktree?.directory,
        prompt: (ctx) =>
          `Задача из Trello: "${ctx.data.task.title}"` +
          (ctx.data.task.description ? `\nОписание: ${ctx.data.task.description}` : "") +
          `\nРаботай ТОЛЬКО внутри текущей директории (это твоя изолированная копия проекта). ` +
          `Реализуй задачу и закоммить изменения осмысленным сообщением. ` +
          `В конце ответь одним абзацем: что сделано и в какой ветке.`,
        outgoing: ["notify"],
        condition: hasWorktree,
      }),
      {
        id: "notify",
        executor: {
          run: async (ctx) => {
            const text = ctx.data.opencode?.text?.trim() || "(агент вернул пустой итог)";
            const token = await rt.vault.get("trello-project-work", "TELEGRAM_BOT_TOKEN").catch(() => "");
            const send = await rt.commands.execute({
              service: "telegram",
              op: "messages.send",
              params: {
                text:
                  `Готово [${ctx.data.project?.label}]: ${ctx.data.task.title}\n` +
                  `Ветка: ${ctx.data.worktree?.branch ?? ctx.data.worktree?.name}\n\n${text.slice(0, MAX_TG)}`,
                ...(token ? { token } : {}),
              },
            });
            if (!send.ok) throw new Error(`telegram send failed: ${send.error}`);
            ctx.data.send = send;
            return ctx;
          },
        },
        outgoing: [],
        condition: hasWorktree,
      },
    ]),
});
