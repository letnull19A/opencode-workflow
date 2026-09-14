import type {
  WireWorkflow,
  WorkflowStartResponse,
  WorkflowStatusResponse,
  WorkflowStopResponse,
  WorkflowsListResponse,
  HooksListResponse,
  HookCreateResponse,
  HookDeleteResponse,
} from "./types";

const API_BASE = "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return body;
}

/** GET /workflows — список зарегистрированных workflow (для селектов и дашборда). */
export function listWorkflows(): Promise<WorkflowsListResponse> {
  return request<WorkflowsListResponse>("/workflows");
}

/** POST /workflow/:id — запуск workflow по id (module || кастомная). */
export function startWorkflow(
  workflowId: string,
  title: string,
  meta?: Record<string, unknown>
): Promise<WorkflowStartResponse> {
  return fetch(`${API_BASE}/workflow/${encodeURIComponent(workflowId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, ...(meta ? { meta } : {}) }),
  }).then(async (res) => {
    const body = (await res.json()) as WorkflowStartResponse;
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    return body;
  });
}

/** GET /workflow/:id/:runId — статус конкретного прогона. */
export function getWorkflowStatus(runId: string): Promise<WorkflowStatusResponse> {
  return request<WorkflowStatusResponse>(`/workflow/any/${encodeURIComponent(runId)}`);
}

/** POST /workflow/:id/:runId/stop — остановка активного рана. */
export function stopWorkflow(workflowId: string, runId: string): Promise<WorkflowStopResponse> {
  return request<WorkflowStopResponse>(
    `/workflow/${encodeURIComponent(workflowId)}/${encodeURIComponent(runId)}/stop`,
    { method: "POST" }
  );
}

/** POST /hooks — создание вебхук-биндинга. */
export function createHook(body: {
  source: string;
  provider: "github" | "generic";
  workflow?: string;
  action?: string;
  domain?: string;
  secretEnv?: string;
  enabled?: boolean;
}): Promise<HookCreateResponse> {
  return request<HookCreateResponse>("/hooks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** GET /hooks — список вебхук-биндингов. */
export function listHooks(): Promise<HooksListResponse> {
  return request<HooksListResponse>("/hooks");
}

/** DELETE /hooks/:id — удаление вебхук-биндинга. */
export function deleteHook(id: string): Promise<HookDeleteResponse> {
  return request<HookDeleteResponse>(`/hooks/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}