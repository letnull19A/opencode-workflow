import type { IEventBus, WorkflowEvent } from "../core/events.ts";
import type { IWorkflowRegistry } from "../core/workflows.ts";
import type { IWorkflowTask } from "@opencode-workflow/sdk";
import { withMove } from "./TaskWatcher.ts";

/** env-список id workflow через запятую, без пустых значений. */
export function parseWorkflowIds(raw?: string): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Карта события → реакторы: id workflow, запускаемые на каждый event. */
export interface WorkflowTaskRouterOptions {
  onReceived?: readonly string[];
  onMoved?: readonly string[];
}

/**
 * Маршрутизатор задач: подписан на task.received/task.moved и для каждого
 * сконфигурированного id запускает workflow. Не мешает ModuleMatcher
 * (module-пайплайн работает параллельно) — реакторы дополняют, не заменяют.
 * Для task.moved в task.meta.move лежат fromList/toList.
 */
export class WorkflowTaskRouter {
  private readonly unsubscribe: () => void;

  constructor(
    bus: IEventBus,
    private readonly registry: IWorkflowRegistry,
    options: WorkflowTaskRouterOptions
  ) {
    this.unsubscribe = bus.subscribe((event) => {
      if (event.type === "task.received") {
        for (const id of options.onReceived ?? []) void this.route(id, event.task, "task.received");
      } else if (event.type === "task.moved") {
        // meta.move зашит роутером из fromList/toList события (для поллинга и
        // webhook единый контракт). Если издатель уже вшил meta.move — withMove
        // идемпотентен, перезапишет тем же значением.
        const moved = withMove(event.task, event.fromList, event.toList);
        for (const id of options.onMoved ?? []) void this.route(id, moved, "task.moved");
      }
    });
  }

  close(): void {
    this.unsubscribe();
  }

  private async route(id: string, task: IWorkflowTask, event: WorkflowEvent["type"]): Promise<void> {
    const handle = this.registry.resolve(id);
    if (!handle) {
      console.error(`[router] workflow "${id}" не зарегистрирован (${event})`);
      return;
    }
    try {
      const runId = await handle.start(task);
      if (runId) console.log(`[router] ${id} → run ${runId} (${event}, task "${task.title}")`);
    } catch (err) {
      console.error(`[router] ${id}: ${String(err)}`);
    }
  }
}