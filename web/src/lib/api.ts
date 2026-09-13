import type { ModuleAction, ModuleDomain, ModuleStartResponse, ModuleStopResponse } from "./types";

const API_BASE = "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return body;
}

/** POST /module — асинхронный запуск пайплайна по имени модуля. */
export function startModule(
  title: string,
  domain?: ModuleDomain,
  action?: ModuleAction
): Promise<ModuleStartResponse> {
  return fetch(`${API_BASE}/module`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, ...(domain ? { domain } : {}), ...(action ? { action } : {}) }),
  }).then(async (res) => {
    const body = (await res.json()) as ModuleStartResponse;
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    return body;
  });
}

/** POST /module/:runId/stop — остановка активного рана пайплайна. */
export function stopModule(runId: string): Promise<ModuleStopResponse> {
  return request<ModuleStopResponse>(`/module/${encodeURIComponent(runId)}/stop`, {
    method: "POST",
  });
}