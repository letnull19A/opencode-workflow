import type { IEventBus } from "../core/events.ts";
import type { ModuleDomain } from "../core/types.ts";
import type { ModulePipeline } from "./ModulePipeline.ts";

export interface ModuleMatcherConfig {
  match: (title: string) => boolean;
}

const ADD_KEYWORDS = /создать?|новый модуль|create|add|implement|разработ[ае]|module|feature/i;
const DOMAIN_PATTERNS: Array<[ModuleDomain, RegExp]> = [
  ["nestjs", /nestjs?|nest\b/i],
  ["dotnet", /\.net\b|dotnet|c#|csharp/i],
  ["frontend", /frontend|front-end|react|vue|angular|ui|компонент/i],
];

/**
 * Матчер «создать новый модуль»: подписан на task.received, решает по
 * заголовку, что задача — добавление модуля, определяет домен и запускает
 * ModulePipeline. Задачи не про «создание» игнорируются (ack уже сделал watcher).
 */
export class ModuleMatcher {
  private readonly match: (title: string) => boolean;
  private readonly unsubscribe: () => void;

  constructor(
    bus: IEventBus,
    private readonly pipeline: ModulePipeline,
    config?: ModuleMatcherConfig
  ) {
    this.match = config?.match ?? defaultMatch;
    this.unsubscribe = bus.subscribe((event) => {
      if (event.type !== "task.received") return;
      if (!this.match(event.task.title)) return;
      void this.pipeline
        .start(event.task, detectDomain(event.task.title))
        .then((state) => {
          console.log(`[pipeline] ${state.runId} finished in ${state.phase}${state.error ? `: ${state.error}` : ""}`);
        })
        .catch((err) => console.error(`[pipeline] ${String(err)}`));
    });
  }

  close(): void {
    this.unsubscribe();
  }
}

export const defaultMatch = (title: string): boolean => ADD_KEYWORDS.test(title);

export function detectDomain(title: string): ModuleDomain {
  for (const [domain, pattern] of DOMAIN_PATTERNS) {
    if (pattern.test(title)) return domain;
  }
  return "general";
}