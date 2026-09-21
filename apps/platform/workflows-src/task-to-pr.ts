import { z } from "zod";
import {
  defineWorkflow,
  graph,
  node,
  opencodeCreateSession,
  opencodeWorktree,
  projectMap,
} from "@opencode-workflow/sdk";
import type {
  CommandResult,
  INodeContext,
  IWorkflowRuntime,
  IWorkflowTask,
  ProjectData,
  SessionData,
  WorktreeData,
} from "@opencode-workflow/sdk";

/**
 * Задача → PR: карточка/issue проходит explore → plan ⇄ validate (цикл
 * с бюджетом) → implement → test → pulls.create → Telegram.
 *
 * Агентные роли — встроенные агенты сервера (заменятся позже):
 * меняются только константой AGENTS ниже, код нод не трогаем.
 * Модель агенту не передаём — её задаёт определение агента на сервере.
 *
 * Запуск: POST /workflow/task-to-pr {title, ...} или
 * WORKFLOW_ON_TASK_RECEIVED=task-to-pr.
 *
 * Env:
 *   TASK_PR_MAX_REVISIONS (default 3) — бюджет цикла plan⇄validate
 *   TASK_PR_GITHUB_REPO (owner/repo, обязателен для pr-ноды)
 *   TASK_PR_BASE_BRANCH (default main)
 */

const AGENTS = {
  explorer: "plan",
  planner: "plan",
  validator: "plan",
  implementer: "build",
  tester: "general",
} as const;

const MAX_TG = 3500;

const ResearchSchema = z.object({
  summary: z.string(),
  relevant_files: z.array(z.string()),
  risks: z.array(z.string()),
});
type Research = z.infer<typeof ResearchSchema>;

const PlanStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  details: z.string(),
  files: z.array(z.string()),
});
const PlanSchema = z.object({
  title: z.string(),
  summary: z.string(),
  steps: z.array(PlanStepSchema).min(1),
  risks: z.array(z.string()),
  test_strategy: z.string(),
});
type Plan = z.infer<typeof PlanSchema>;

const ReviewSchema = z.object({
  verdict: z.enum(["approved", "needs_work"]),
  comments: z.array(
    z.object({
      step_id: z.string().nullable(),
      severity: z.enum(["critical", "major", "minor"]),
      comment: z.string(),
    })
  ),
});
type Review = z.infer<typeof ReviewSchema>;

interface TaskPrData extends SessionData, ProjectData, WorktreeData {
  task: IWorkflowTask;
  branch: string;
  research: Research | null;
  plan: Plan | null;
  review: Review | null;
  revision: number;
  maxRevisions: number;
  prUrl: string;
  send: CommandResult;
}

function jsonInstruction(): string {
  return [
    "IMPORTANT: заверши ответ единственным fenced-блоком с ТОЛЬКО JSON-объектом, без комментариев внутри блока:",
    "```json",
    "{ ... }",
    "```",
  ].join("\n");
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw: string | undefined = fenced ? fenced[1] : undefined;
  const candidate = raw ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("в ответе нет JSON-объекта");
  return JSON.parse(candidate.slice(start, end + 1));
}

function taskBrief(ctx: INodeContext<TaskPrData>): string {
  const t = ctx.data.task;
  return (
    `Задача: "${t.title}"` +
    (t.description ? `\nОписание: ${t.description}` : "") +
    `\nРабочая копия: ${ctx.data.worktree?.directory ?? "(нет)"}` +
    `\nВетка: ${ctx.data.branch}`
  );
}

const hasProject = (ctx: INodeContext<TaskPrData>): boolean => Boolean(ctx.data.project);
const hasWorktree = (ctx: INodeContext<TaskPrData>): boolean =>
  Boolean(ctx.data.worktree?.directory);
const needsWork = (ctx: INodeContext<TaskPrData>): boolean =>
  ctx.data.review?.verdict !== "approved" && ctx.data.revision < ctx.data.maxRevisions;
const exhausted = (ctx: INodeContext<TaskPrData>): boolean =>
  ctx.data.review?.verdict !== "approved" && ctx.data.revision >= ctx.data.maxRevisions;
const approved = (ctx: INodeContext<TaskPrData>): boolean =>
  ctx.data.review?.verdict === "approved";

async function runAgent(
  rt: IWorkflowRuntime,
  ctx: INodeContext<TaskPrData>,
  agent: string,
  prompt: string
): Promise<string> {
  const res = await rt.executor.runSession({
    sessionId: ctx.data.opencode?.sessionId,
    directory: ctx.data.worktree?.directory,
    agent,
    prompt,
    signal: ctx.signal,
  });
  if (ctx.data.opencode) ctx.data.opencode.text = res.text;
  return res.text;
}

function branchFor(task: IWorkflowTask): string {
  const slug = (task.title || task.externalId || "task")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `ai/${task.source}/${slug || task.externalId}`;
}

export default defineWorkflow<TaskPrData>({
  id: "task-to-pr",
  label: "Task → explore → plan ⇄ validate → implement → test → PR",
  phases: ["map", "worktree", "create", "explore", "plan", "validate", "implement", "test", "pr", "notify"],
  seed: (task) => ({
    task,
    branch: branchFor(task),
    research: null,
    plan: null,
    review: null,
    revision: 0,
    maxRevisions: Number(process.env.TASK_PR_MAX_REVISIONS ?? 3),
    prUrl: "",
    send: { ok: false, error: "not sent" },
  }),
  create: (rt: IWorkflowRuntime) =>
    graph<TaskPrData>("map", [
      projectMap<TaskPrData>(rt, "map", { outgoing: ["worktree"] }),
      opencodeWorktree<TaskPrData>(rt, "worktree", {
        directory: (ctx) => ctx.data.project?.directory,
        name: (ctx) => `task-${ctx.data.task.externalId}`,
        outgoing: ["create"],
        condition: hasProject,
      }),
      opencodeCreateSession<TaskPrData>(rt, "create", {
        title: (ctx) => `task-to-pr: ${ctx.data.task.title}`,
        directory: (ctx) => ctx.data.worktree?.directory,
        outgoing: ["explore"],
        condition: hasWorktree,
      }),

      node<TaskPrData>(
        "explore",
        {
          run: async (ctx) => {
            const text = await runAgent(
              rt,
              ctx,
              AGENTS.explorer,
              [
                "Изучи репозиторий в контексте задачи ниже. Только чтение, ничего не меняй.",
                "Верни structured JSON: {summary, relevant_files[], risks[]}.",
                "",
                taskBrief(ctx),
                "",
                jsonInstruction(),
              ].join("\n")
            );
            ctx.data.research = ResearchSchema.parse(extractJson(text));
            return ctx;
          },
        },
        { outgoing: ["plan"], condition: hasWorktree }
      ),

      node<TaskPrData>(
        "plan",
        {
          run: async (ctx) => {
            ctx.data.revision += 1;
            const comments =
              ctx.data.review && ctx.data.review.comments.length > 0
                ? `\n\n## Замечания ревьюера (исправь ВСЕ):\n${JSON.stringify(ctx.data.review.comments, null, 2)}`
                : "";
            const text = await runAgent(
              rt,
              ctx,
              AGENTS.planner,
              [
                ctx.data.revision > 1
                  ? "Пересмотри план с учётом замечаний и верни ПОЛНЫЙ обновлённый план."
                  : "Составь пошаговый план реализации задачи.",
                "Опирайся на исследование кодовой базы. Шаги строго последовательные.",
                "Верни structured JSON: {title, summary, steps[{id,title,details,files[]}], risks[], test_strategy}.",
                "",
                taskBrief(ctx),
                "",
                "## Исследование",
                JSON.stringify(ctx.data.research ?? {}, null, 2),
                comments,
                "",
                jsonInstruction(),
              ].join("\n")
            );
            try {
              ctx.data.plan = PlanSchema.parse(extractJson(text));
            } catch {
              ctx.data.plan = null;
            }
            ctx.data.review = null;
            return ctx;
          },
        },
        { outgoing: ["validate"], condition: hasWorktree }
      ),

      node<TaskPrData>(
        "validate",
        {
          run: async (ctx) => {
            const planText = ctx.data.plan ? JSON.stringify(ctx.data.plan, null, 2) : "(план не распарсился)";
            const text = await runAgent(
              rt,
              ctx,
              AGENTS.validator,
              [
                "Ты строгий критик. Проверь план: противоречия, пропущенные шаги, неверные пути, scope creep, слабая тест-стратегия.",
                "approved — ТОЛЬКО если нет critical/major. Каждый комментарий: step_id (или null) + severity + что исправить.",
                'Верни structured JSON: {verdict: "approved"|"needs_work", comments[{step_id, severity, comment}]}.',
                "",
                taskBrief(ctx),
                "",
                "## Исследование",
                JSON.stringify(ctx.data.research ?? {}, null, 2),
                "",
                "## План",
                planText,
                "",
                jsonInstruction(),
              ].join("\n")
            );
            try {
              ctx.data.review = ReviewSchema.parse(extractJson(text));
            } catch {
              ctx.data.review = {
                verdict: "needs_work",
                comments: [{ step_id: null, severity: "major", comment: "Ответ не соответствует схеме Review — верни валидный JSON." }],
              };
            }
            return ctx;
          },
        },
        { outgoing: ["revise", "proceed", "abort"], condition: hasWorktree }
      ),

      node<TaskPrData>(
        "revise",
        {
          run: async (ctx) => ctx,
        },
        { outgoing: ["plan"], condition: needsWork }
      ),
      node<TaskPrData>(
        "abort",
        {
          run: async (ctx) => {
            throw new Error(
              `план не аппрувнут за ${ctx.data.revision} ревизий: ` +
                JSON.stringify(ctx.data.review?.comments ?? []).slice(0, 500)
            );
          },
        },
        { outgoing: [], condition: exhausted }
      ),
      node<TaskPrData>(
        "proceed",
        {
          run: async (ctx) => ctx,
        },
        { outgoing: ["implement"], condition: approved }
      ),

      node<TaskPrData>(
        "implement",
        {
          run: async (ctx) => {
            await runAgent(
              rt,
              ctx,
              AGENTS.implementer,
              [
                "Реализуй аппрувнутый план в этом репозитории.",
                `Сначала: git checkout -B ${ctx.data.branch}`,
                "Затем выполняй шаги строго по порядку, после каждого шага — коммит.",
                "Не выходи за scope плана. В конце: запушь ветку в origin.",
                "Не создавай PR.",
                "",
                "## План",
                JSON.stringify(ctx.data.plan, null, 2),
              ].join("\n")
            );
            return ctx;
          },
        },
        { outgoing: ["test"], condition: hasWorktree }
      ),

      node<TaskPrData>(
        "test",
        {
          run: async (ctx) => {
            await runAgent(
              rt,
              ctx,
              AGENTS.tester,
              [
                "Напиши unit-тесты для изменённых функций — ТОЛЬКО тестовые файлы, исходники не трогай.",
                "Сначала обычные кейсы, затем границы и hostile inputs (null, пустые коллекции, огромные значения).",
                "Цель — сломать функцию. Прогони тестовый раннер проекта, добейся зелёного прогона.",
                "Закоммить тесты и запушь ветку.",
                `Тест-стратегия из плана: ${ctx.data.plan?.test_strategy ?? "(нет)"}`,
              ].join("\n")
            );
            return ctx;
          },
        },
        { outgoing: ["pr"], condition: hasWorktree }
      ),

      node<TaskPrData>(
        "pr",
        {
          run: async (ctx) => {
            const repo = process.env.TASK_PR_GITHUB_REPO ?? "";
            if (!repo) throw new Error("TASK_PR_GITHUB_REPO не задан (owner/repo)");
            const base = process.env.TASK_PR_BASE_BRANCH ?? "main";
            const res = await rt.commands.execute({
              service: "github",
              op: "pulls.create",
              params: {
                repo,
                title: ctx.data.task.title,
                head: ctx.data.branch,
                base,
                body:
                  `Summary: ${ctx.data.plan?.summary ?? ""}\n\n` +
                  `Test strategy: ${ctx.data.plan?.test_strategy ?? ""}\n\n` +
                  `Task: ${ctx.data.task.url ?? ctx.data.task.externalId}`,
              },
            });
            if (!res.ok) throw new Error(`pulls.create failed: ${res.error}`);
            const url = (res.data as { html_url?: string })?.html_url ?? "";
            const m = url.match(/https:\/\/github\.com\/[^\s"']+\/pull\/\d+/);
            ctx.data.prUrl = m?.[0] ?? url;
            return ctx;
          },
        },
        { outgoing: ["notify"], condition: hasWorktree }
      ),

      {
        id: "notify",
        executor: {
          run: async (ctx) => {
            const text = ctx.data.prUrl
              ? `PR: ${ctx.data.prUrl}`
              : ctx.data.opencode?.text?.trim() || "(агент вернул пустой итог)";
            const token = await rt.vault.get("task-to-pr", "TELEGRAM_BOT_TOKEN").catch(() => "");
            const send = await rt.commands.execute({
              service: "telegram",
              op: "messages.send",
              params: {
                text:
                  `Готово [${ctx.data.project?.label}]: ${ctx.data.task.title}\n` +
                  `Ветка: ${ctx.data.branch}\n\n${text.slice(0, MAX_TG)}`,
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
