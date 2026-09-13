import type { ModuleAction, ModuleDomain, PipelinePhase } from "../core/types.ts";
import type { IWorkflowTask } from "../core/task.ts";
import type { IModuleWorker } from "../core/worker.ts";

const VERIFY_FAIL_MARKER = "FAIL";

export interface ModuleWorkerConfig {
  readonly id: string;
  readonly domain: ModuleDomain;
  language: string;
  testRunner: string;
}

/** Базовый воркер: фазы pipeline → промпты + verify; домен задаёт hints. */
export abstract class BaseModuleWorker implements IModuleWorker {
  constructor(protected readonly config: ModuleWorkerConfig) {}

  get id(): string {
    return this.config.id;
  }

  get domain(): ModuleDomain {
    return this.config.domain;
  }

  canHandle(action: ModuleAction): boolean {
    return action === "add" || action === "update" || action === "delete";
  }

  promptFor(phase: PipelinePhase, task: IWorkflowTask): string {
    const base = `Task: "${task.title}"${task.description ? ` — ${task.description}` : ""} (domain: ${this.config.domain}, language: ${this.config.language}).`;
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

  verify(text: string): boolean {
    return !text.includes(VERIFY_FAIL_MARKER);
  }

  protected abstract testRunnerHint(): string;
}