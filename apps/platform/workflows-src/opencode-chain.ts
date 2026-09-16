import { defineWorkflow, graph, opencodeCreateSession, opencodeSessionPrompt } from "@opencode-workflow/sdk";
import type { IWorkflowRuntime, IWorkflowTask, SessionData } from "@opencode-workflow/sdk";

interface ChainData extends SessionData {
  task: IWorkflowTask;
}

/**
 * Демо мульти-тёрна: одна сессия на сервере, контекст копится между нодами.
 * create (пустая сессия) → summarize (читает песочницу) → plan (по резюме).
 * Работает в opencode-workspace — файлы репозитория не трогает.
 * Ручной запуск: POST /workflow/opencode-chain { "title": "..." }.
 */
export default defineWorkflow<ChainData>({
  id: "opencode-chain",
  label: "Opencode session chain (demo)",
  phases: ["create", "summarize", "plan"],
  seed: (task) => ({ task }),
  create: (rt: IWorkflowRuntime) =>
    graph<ChainData>("create", [
      opencodeCreateSession<ChainData>(rt, "create", {
        title: (ctx) => `chain: ${ctx.data.task.title}`,
        outgoing: ["summarize"],
      }),
      opencodeSessionPrompt<ChainData>(rt, "summarize", {
        prompt: (ctx) =>
          `Прочитай файл demo-task.md в текущей директории и суммируй задачу ` +
          `одним абзацем. Контекст карточки: ${ctx.data.task.title}. Только текст, без записи файлов.`,
        outgoing: ["plan"],
      }),
      opencodeSessionPrompt<ChainData>(rt, "plan", {
        prompt: "Составь короткий план из 3 шагов по этому резюме. Только текст, без записи файлов.",
        outgoing: [],
      }),
    ]),
});
