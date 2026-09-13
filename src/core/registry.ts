import type { ModuleAction, ModuleDomain } from "./types.ts";
import type { IModuleWorker } from "./worker.ts";

export interface IWorkerRegistry {
  resolve(domain: ModuleDomain, action: ModuleAction): IModuleWorker[];
}
