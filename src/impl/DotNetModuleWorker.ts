import { BaseModuleWorker } from "./BaseModuleWorker.ts";

export class DotNetModuleWorker extends BaseModuleWorker {
  constructor() {
    super({ id: "dotnet", domain: "dotnet", language: "csharp", testRunner: "dotnet test" });
  }

  protected testRunnerHint(): string {
    return "dotnet test in a .NET solution; reach specs via .opencode (context7 only for framework syntax)";
  }
}