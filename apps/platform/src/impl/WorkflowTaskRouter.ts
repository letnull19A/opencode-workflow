import type { IEventBus } from "../core/events.ts";
import type { IWorkflowRegistry } from "../core/workflows.ts";
import type { IWorkflowTask } from "@opencode-workflow/sdk";

/** env-список id workflow через запятую, без пустых значений. */
export function parseWorkflowIds(raw?: string): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Маршрутизатор задач: подписан на task.received и для каждого сконфигури
 * id (WORKFLOW_ON_TASK_RECEIVED) запускает соответствующую workflow.
 * Не мешает ModuleMatcher (module-пайплайн работает параллельно) —
 * уведомительная workflow просто дополняет, а не замещает.
 */
export class WorkflowTaskRouter {
  private readonly unsubscribe: () => void;

  constructor(
    bus: IEventBus,
    private readonly registry: IWorkflowRegistry,
    private readonly workflowIds: readonly string[]
  ) {
    this.unsubscribe = bus.subscribe((event) => {
      if (event.type !== "task.received") return;
      for (const id of this.workflowIds) void this.route(id, event.task);
    });
  }

  close(): void {
    this.unsubscribe();
  }

  private async route(id: string, task: IWorkflowTask): Promise<void> {
    const handle = this.registry.resolve(id);
    if (!handle) {
      console.error(`[router] workflow "${id}" не зарегистрирован (WORKFLOW_ON_TASK_RECEIVED)`);
      return;
    }
    try {
      const runId = await handle.start(task);
      if (runId) console.log(`[router] ${id} → run ${runId} (task "${task.title}")`);
    } catch (err) {
      console.error(`[router] ${id}: ${String(err)}`);
    }
  }
}