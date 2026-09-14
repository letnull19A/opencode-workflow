/** Wire-типы, зеркалящие контракты бэкенда (см. docs/reference/contracts.md). */

export type ModuleAction = "add" | "update" | "delete" | "decompose";
export type ModuleDomain = "nestjs" | "dotnet" | "frontend" | "general";

export type PipelinePhase =
  | "spec"
  | "planning"
  | "tests"
  | "implementation"
  | "verification"
  | "done"
  | "failed"
  | "cancelled";

/** Причина отклонения входа вебхука (src/core/events.ts — EntryPointIgnoreReason). */
export type WireIgnoreReason =
  | "unknown_binding"
  | "binding_disabled"
  | "bad_signature"
  | "misconfigured"
  | "filter_mismatch"
  | "matcher_reject"
  | "duplicate_delivery";

/** Событие платформы из шины (src/core/events.ts). */
export type WireEvent =
  | { type: "task.received"; task: WireTask }
  | { type: "pipeline.started"; runId: string; task: WireTask; action: ModuleAction; domain: ModuleDomain }
  | { type: "pipeline.phase"; runId: string; phase: PipelinePhase }
  | { type: "pipeline.done"; runId: string }
  | { type: "pipeline.failed"; runId: string; error: string }
  | { type: "pipeline.cancelled"; runId: string }
  | { type: "pipeline.delivered"; runId: string; commit?: string; pushed: boolean }
  | { type: "pipeline.delivery_failed"; runId: string; error: string }
  | { type: "entrypoint.ignored"; hookId: string | null; reason: WireIgnoreReason; detail?: string };

export interface WireTask {
  externalId: string;
  source: string;
  title: string;
  description?: string;
  url?: string;
  labels?: string[];
  attachments?: WireTaskAttachment[];
  createdAt?: string;
}

export interface WireTaskAttachment {
  name: string;
  url: string;
  kind?: "image" | "file" | "link";
}

/** Ответ POST /module. */
export interface ModuleStartResponse {
  ok: boolean;
  runId: string;
  domain: ModuleDomain;
  action: ModuleAction;
  error?: string;
}

/** Ответ POST /module/:runId/stop. */
export interface ModuleStopResponse {
  ok: boolean;
  runId: string;
  stopped: boolean;
  error?: string;
}

/** SSE-фрейм. */
export interface StreamFrame<
  T extends WireEvent["type"],
  P extends Record<string, unknown>,
> {
  type: T;
  data: string;
}

export const ACTION_PHASES: Readonly<Record<ModuleAction, readonly PipelinePhase[]>> = {
  add: ["spec", "planning", "tests", "implementation", "verification"],
  update: ["tests", "implementation", "verification"],
  delete: ["implementation", "verification"],
  decompose: ["spec", "planning"],
};

/** Вебхук-биндинг (src/core/webhook.ts — IWebhookBinding), wire-зеркало. */
export interface WireWebhookBinding {
  id: string;
  source: string;
  provider: "github" | "generic";
  action?: ModuleAction;
  domain?: ModuleDomain;
  secretEnv?: string;
  enabled: boolean;
  createdAt: string;
}

export interface HooksListResponse {
  ok: boolean;
  hooks: WireWebhookBinding[];
}

export interface HookCreateResponse {
  ok: boolean;
  id: string;
  url: string;
}

export interface HookDeleteResponse {
  ok: boolean;
  removed: string;
}

export const KNOWN_ACTIONS: readonly ModuleAction[] = ["add", "update", "delete", "decompose"];
export const KNOWN_DOMAINS: readonly ModuleDomain[] = ["nestjs", "dotnet", "frontend", "general"];