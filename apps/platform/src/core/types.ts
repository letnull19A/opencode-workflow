export type ModuleDomain = "nestjs" | "dotnet" | "frontend" | "general";

export type ModuleAction = "add" | "update" | "delete" | "decompose";

/**
 * Жизненный цикл задачи в пайплайне (state machine).
 * Линейный ход + ограниченный цикл verification -> tests|implementation
 * (бюджет повторов в IPipelineState.attempts).
 * Терминальные состояния: done — успех, failed — провал фаз,
 * cancelled — остановлен пользователем через stop().
 */
export type PipelinePhase =
  | "spec"
  | "planning"
  | "tests"
  | "implementation"
  | "verification"
  | "done"
  | "failed"
  | "cancelled";