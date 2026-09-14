import { BaseModuleWorker } from "./BaseModuleWorker.ts";

export class GeneralModuleWorker extends BaseModuleWorker {
  constructor() {
    super({ id: "general", domain: "general", language: "typescript", testRunner: "test" });
  }

  protected testRunnerHint(): string {
    return "generic";
  }
}