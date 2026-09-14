import { defineWorkflow, graph, node, session } from "@opencode-workflow/sdk";
import type { INodeContext, IWorkflowRuntime, IWorkflowTask } from "@opencode-workflow/sdk";

/**
 * Пример кастомной workflow «release-bump»: анализ, бамп версии,
 * верификация (цикл с гардом, до 3 попыток). Собирается в артефакт
 * через build-workflow, загружается платформой из WORKFLOWS_DIR.
 */
interface BumpData {
  task: IWorkflowTask;
  attempts: number;
  ok: boolean;
  report: string;
}

export default defineWorkflow<BumpData>({
  id: "release-bump",
  label: "Release bump",
  phases: ["analyze", "bump", "verify"],
  seed: (task) => ({ task, attempts: 0, ok: false, report: "" }),
  create: (rt: IWorkflowRuntime) =>
    graph<BumpData>("analyze", [
      node<BumpData>(
        "analyze",
        {
          run: async (ctx) => {
            const res = await session(
              rt,
              ctx,
              `Проанализируй релизную очередь. Задача: "${ctx.data.task.title}". Верни короткий план бампа версии.`,
              "build"
            );
            ctx.data.report = res.text;
            return ctx;
          },
        },
        { outgoing: ["bump"] }
      ),
      node<BumpData>(
        "bump",
        {
          run: async (ctx) => {
            ctx.data.attempts += 1;
            const res = await session(
              rt,
              ctx,
              `Выполни bump релизной версии (попытка ${ctx.data.attempts}). Контекст: ${ctx.data.report.slice(0, 400)}`,
              "build"
            );
            ctx.data.report = res.text;
            ctx.data.ok = true;
            return ctx;
          },
        },
        { outgoing: ["verify"] }
      ),
      node<BumpData>(
        "verify",
        {
          run: async (ctx) => {
            if (ctx.data.attempts < 3) ctx.data.ok = false;
            return ctx;
          },
        },
        {
          outgoing: ["bump"],
          condition: (ctx: INodeContext<BumpData>) => !ctx.data.ok,
        }
      ),
    ]),
});