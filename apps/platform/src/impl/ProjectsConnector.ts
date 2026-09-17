import type { CommandResult, ICommand, IServiceConnector } from "@opencode-workflow/sdk";
import type { IProjectMap } from "../core/projects.ts";

/**
 * Коннектор карты проектов: чтение/запись маппинга лейбл → директория
 * как команды (service "projects"). Datasource для Map-ноды: workflow
 * резолвит проект задачи, платформа секретов тут не держит.
 */
export class ProjectsConnector implements IServiceConnector {
  readonly service = "projects";

  constructor(private readonly map: IProjectMap) {}

  canHandle(service: string): boolean {
    return service === this.service;
  }

  async execute(command: ICommand, _signal?: AbortSignal): Promise<CommandResult> {
    try {
      switch (command.op) {
        case "list":
          return { ok: true, data: { entries: await this.map.entries() } };
        case "get": {
          const label = ProjectsConnector.str(command.params.label, "label");
          const entry = await this.map.byLabel(label);
          if (!entry) return { ok: false, error: `нет маппинга для лейбла "${label}"` };
          return { ok: true, data: { entry } };
        }
        case "set": {
          const label = ProjectsConnector.str(command.params.label, "label");
          const directory = ProjectsConnector.str(command.params.directory, "directory");
          await this.map.set(label, directory);
          return { ok: true, data: { label, directory } };
        }
        case "remove": {
          const label = ProjectsConnector.str(command.params.label, "label");
          const removed = await this.map.remove(label);
          if (!removed) return { ok: false, error: `нет маппинга для лейбла "${label}"` };
          return { ok: true, data: { label } };
        }
        default:
          return { ok: false, error: `unknown op "${command.op}"` };
      }
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  private static str(value: unknown, what: string): string {
    if (typeof value !== "string" || !value) throw new Error(`для "projects.*" обязателен params.${what}`);
    return value;
  }
}
