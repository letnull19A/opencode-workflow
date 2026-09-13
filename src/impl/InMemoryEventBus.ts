import type { IEventBus, IEventHistory, WorkflowEvent } from "../core/events.ts";

/** Максимум событий, отдаваемых новому SSE-подписчику как snapshot. */
const HISTORY_LIMIT = Number(process.env.EVENT_HISTORY_LIMIT ?? 200);

/**
 * In-memory шина событий: подписчики зовутся синхронно в порядке подписки,
 * последние события буферизуются для поздних подписчиков (SSE-реплей).
 */
export class InMemoryEventBus implements IEventBus, IEventHistory {
  private readonly listeners: Array<(event: WorkflowEvent) => void> = [];
  private readonly buffer: WorkflowEvent[] = [];

  publish(event: WorkflowEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > HISTORY_LIMIT) this.buffer.splice(0, this.buffer.length - HISTORY_LIMIT);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error(`event listener failed: ${String(err)}`);
      }
    }
  }

  subscribe(listener: (event: WorkflowEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  history(): readonly WorkflowEvent[] {
    return this.buffer;
  }
}