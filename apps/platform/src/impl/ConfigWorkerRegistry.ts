import type { ModuleAction, ModuleDomain } from "../core/types.ts";
import type { IModuleWorker } from "../core/worker.ts";
import type { IWorkerRegistry } from "../core/registry.ts";

/**
 * Реестр воркеров: сопоставление домен + action → IModuleWorker.
 * Конфигурируется из WORKER_REGISTRY_JSON или дефолтным списком.
 * Resolve фильтрует по domain, возвращая все worker'ы с canHandle.
 */
export class ConfigWorkerRegistry implements IWorkerRegistry {
  private readonly workers: IModuleWorker[];

  constructor(source?: IModuleWorker[]) {
    this.workers = source ?? [];
  }

  resolve(domain: ModuleDomain, action: ModuleAction): IModuleWorker[] {
    const exact = this.workers.filter((w) => w.domain === domain && w.canHandle(action));
    if (exact.length > 0) return exact;
    return this.workers.filter((w) => w.domain === "general" && w.canHandle(action));
  }
}