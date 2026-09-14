import type { IWorkflowHandle, IWorkflowRegistry } from "../core/workflows.ts";

/** In-memory реестр workflow: register/resolve/list. Хранение ключа — id. */
export class WorkflowRegistry implements IWorkflowRegistry {
  private readonly handles = new Map<string, IWorkflowHandle>();

  register(handle: IWorkflowHandle): void {
    this.handles.set(handle.id, handle);
  }

  unregister(id: string): boolean {
    return this.handles.delete(id);
  }

  resolve(id?: string): IWorkflowHandle | undefined {
    return id ? this.handles.get(id) : undefined;
  }

  list(): IWorkflowHandle[] {
    return [...this.handles.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
}