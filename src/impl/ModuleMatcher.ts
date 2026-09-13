import type { IEventBus } from "../core/events.ts";
import type { ModuleAction, ModuleDomain } from "../core/types.ts";
import type { ModulePipeline } from "./ModulePipeline.ts";

export interface ModuleMatcherConfig {
  match: (title: string) => boolean;
}

const ADD_KEYWORDS = /создать?|новый модуль|create|add|implement|разработ[ае]|module|feature/i;
const UPDATE_KEYWORDS = /обнови|измени|попра[вв]|update|change|refactor|передела/i;
const DELETE_KEYWORDS = /удали|убери|remove|delete|почисти/i;
const DECOMPOSE_KEYWORDS = /декомпози|разб[ие]|split|decouple|разнеси|разнест|дроб/i;
const DOMAIN_PATTERNS: Array<[ModuleDomain, RegExp]> = [
  ["nestjs", /nestjs?|nest\b/i],
  ["dotnet", /\.net\b|dotnet|c#|csharp/i],
  ["frontend", /frontend|front-end|react|vue|angular|ui|компонент/i],
];

/**
 * Матчер: подписан на task.received, по заголовку определяет стратегию
 * (ModuleAction) и домен, запускает ModulePipeline. Типы действий имеют
 * приоритет: decompose → delete → update → add.
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
      const title = event.task.title;
      if (!this.match(title)) return;
      const action = detectAction(title);
      void this.pipeline
        .start(event.task, detectDomain(title), action)
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

export const defaultMatch = (title: string): boolean =>
  ADD_KEYWORDS.test(title) || UPDATE_KEYWORDS.test(title) || DELETE_KEYWORDS.test(title) || DECOMPOSE_KEYWORDS.test(title);

export function detectAction(title: string): ModuleAction {
  if (DECOMPOSE_KEYWORDS.test(title)) return "decompose";
  if (DELETE_KEYWORDS.test(title)) return "delete";
  if (UPDATE_KEYWORDS.test(title)) return "update";
  return "add";
}

export function detectDomain(title: string): ModuleDomain {
  for (const [domain, pattern] of DOMAIN_PATTERNS) {
    if (pattern.test(title)) return domain;
  }
  return "general";
}