import type { ModuleAction, ModuleDomain, PipelinePhase } from "../core/types.ts";
import type { IWorkflowTask } from "@opencode-workflow/sdk";
import type { IModuleWorker } from "../core/worker.ts";

const VERIFY_FAIL_MARKER = "FAIL";

export interface ModuleWorkerConfig {
  readonly id: string;
  readonly domain: ModuleDomain;
  language: string;
  testRunner: string;
}

/** Базовый воркер: стратегия действия + фаза → промпт; verify по маркеру FAIL. */
export abstract class BaseModuleWorker implements IModuleWorker {
  constructor(protected readonly config: ModuleWorkerConfig) {}

  get id(): string {
    return this.config.id;
  }

  get domain(): ModuleDomain {
    return this.config.domain;
  }

  canHandle(action: ModuleAction): boolean {
    return action === "add" || action === "update" || action === "delete" || action === "decompose";
  }

  promptFor(action: ModuleAction, phase: PipelinePhase, task: IWorkflowTask): string {
    const base = `Task: "${task.title}"${task.description ? ` — ${task.description}` : ""} (domain: ${this.config.domain}, language: ${this.config.language}).`;
    switch (action) {
      case "update":
        return this.updatePrompt(phase, base);
      case "delete":
        return this.deletePrompt(phase, base);
      case "decompose":
        return this.decomposePrompt(phase, base);
      default:
        return this.addPrompt(phase, base);
    }
  }

  verify(text: string): boolean {
    return !text.includes(VERIFY_FAIL_MARKER);
  }

  /**
   * Проксирование фаз на специалистов пакета `.opencode/agent/`:
   * tests → unit-test, изменение/удаление/декомпозиция → refactor,
   * спецификация и верификация → общий агент (build).
   */
  agentFor(action: ModuleAction, phase: PipelinePhase): string | undefined {
    if (phase === "tests") return "unit-test";
    if ((action === "update" || action === "delete" || action === "decompose") && phase === "implementation") {
      return "refactor";
    }
    return undefined;
  }

  protected testRunnerHint(): string {
    return "test";
  }

  private addPrompt(phase: PipelinePhase, base: string): string {
    switch (phase) {
      case "spec":
        return `${base} Write a module spec: purpose, boundaries, data, error cases.`;
      case "planning":
        return `${base} Do tests need to change? Does the suite reflect the spec? Plan implementation steps.`;
      case "tests":
        return `${base} Write or update unit tests to match the spec (${this.testRunnerHint()}).`;
      case "implementation":
        return `${base} Implement the module per the spec. Tests must pass.`;
      case "verification":
        return `${base} Verify: do tests match the spec and pass? Answer exactly PASS or FAIL.`;
      default:
        return base;
    }
  }

  private updatePrompt(phase: PipelinePhase, base: string): string {
    switch (phase) {
      case "tests":
        return `${base} Update existing unit tests to the new behavior (${this.testRunnerHint()}).`;
      case "implementation":
        return `${base} Update the module implementation so the changed tests pass.`;
      case "verification":
        return `${base} Verify: do the changed tests pass? Answer exactly PASS or FAIL.`;
      default:
        return base;
    }
  }

  private deletePrompt(phase: PipelinePhase, base: string): string {
    switch (phase) {
      case "implementation":
        return `${base} Remove the module and its tests. Leave no references.`;
      case "verification":
        return `${base} Verify: is the module fully removed, no references left? Answer exactly PASS or FAIL.`;
      default:
        return base;
    }
  }

  private decomposePrompt(phase: PipelinePhase, base: string): string {
    switch (phase) {
      case "spec":
        return `${base} Spec the decomposed submodules: boundaries, ownership, data flow between them.`;
      case "planning":
        return `${base} Plan the split: which parts move where, what changes interfaces. Do not implement.`;
      default:
        return base;
    }
  }
}