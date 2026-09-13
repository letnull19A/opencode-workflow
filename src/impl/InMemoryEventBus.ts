import type { IEventBus, WorkflowEvent } from "../core/events.ts";

/** In-memory шина событий: подписчики зовутся синхронно в порядке подписки. */
export class InMemoryEventBus implements IEventBus {
  private readonly listeners: Array<(event: WorkflowEvent) => void> = [];

  publish(event: WorkflowEvent): void {
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
}