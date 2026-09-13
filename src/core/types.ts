export type ModuleDomain = "nestjs" | "dotnet" | "frontend" | "general";

export type ModuleAction = "add" | "update" | "delete" | "decompose";

// Жизненный цикл задачи в пайплайне (state machine).
// Линейный ход + ограниченный цикл verification -> tests|implementation
// (бюджет повторов в IPipelineState.attempts).
export type PipelinePhase =
  | "spec"
  | "planning"
  | "tests"
  | "implementation"
  | "verification"
  | "done"
  | "failed";

// Результат одного прогона агента: без привязки к SDK.
export type PromptSessionResult = {
  sessionId: string;
  text: string;
};