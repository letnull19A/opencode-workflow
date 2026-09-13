import { BaseModuleWorker } from "./BaseModuleWorker.ts";

export class NestJSModuleWorker extends BaseModuleWorker {
  constructor() {
    super({ id: "nestjs", domain: "nestjs", language: "typescript", testRunner: "jest" });
  }

  protected testRunnerHint(): string {
    return "jest in a NestJS app; reach specs via .opencode (context7 only for framework syntax)";
  }
}