# API Contracts

Machine-checkable schemas for the webhook API, aligned with the OpenAPI 3.0
spec shipped at [`/openapi.yaml`](/openapi.yaml) (in the repo:
`docs/public/openapi.yaml`).

Unless noted, all bodies are JSON and every endpoint answers in the uniform
shape `{ ok: boolean, … }`.

## Shared enums

```ts
/** Module-development strategy. */
type ModuleAction = "add" | "update" | "delete" | "decompose";

/** Target module domain. */
type ModuleDomain = "nestjs" | "dotnet" | "frontend" | "general";

/** Phase machine state of a pipeline run. */
type PipelinePhase =
  | "spec"
  | "planning"
  | "tests"
  | "implementation"
  | "verification"
  | "done"
  | "failed"
  | "cancelled";
```

## Shared types

```ts
export interface IWorkflowTask {
  externalId: string;        // dedup key — Trello card id, or slug from CLI
  source: string;            // "file" | "trello" | "cli" | "web" | …
  title: string;
  description?: string;
  url?: string;
  labels?: string[];
  attachments?: IWorkflowAttachment[];
  createdAt: string;         // ISO-8601
  meta?: Record<string, unknown>;
}

export interface IWorkflowAttachment {
  name: string;
  url: string;
  kind?: "image" | "file" | "link";
}

export interface IPipelineState {
  runId: string;             // "run-<source>-<externalId>"
  phase: PipelinePhase;
  externalId: string;
  source: string;
  attempts: number;          // verification retries already used
  action: ModuleAction;
  error?: string;            // present when phase === "failed"
}
```

## Endpoint contracts

### `GET /health`

| Status | Body |
|---|---|
| `200` | `{ ok: true }` |

### `GET /agents`

| Status | Body |
|---|---|
| `200` | `{ ok: true, agents: string[] }` |
| `500` | `Error` — server could not enumerate agents |

### `GET|POST /run`

Agent is optional; query param `?agent=` (GET/POST) or body `{ "agent" }`
(POST). Defaults to `build`. Unknown agents are rejected.

Request body (POST, optional):

```json
{ "agent": "refactor" }
```

Response (`200`):

```json
{
  "ok": true,
  "prompt": "Test",
  "agent": "refactor",
  "sessionId": "ses_f66c238c6ffeoKoSwtUDOm3mQu",
  "response": "...",
  "durationMs": 48112
}
```

| Field | Type | Description |
|---|---|---|
| `prompt` | `string` | The workflow prompt that ran |
| `agent` | `string` | Resolved agent (default `build`) |
| `sessionId` | `string` | opencode session id |
| `response` | `string` | Final assistant text (may be empty) |
| `durationMs` | `number` | Wall time of the run |

Errors: `400` for unknown agent (`Error` + `agents: string[]`), `500` if the
session failed.

### `POST /task`

Request — `IWorkflowTask`, only `externalId` and `title` are validated:

```json
{
  "externalId": "t-42",
  "source": "web",
  "title": "Create billing module",
  "createdAt": "2026-09-13T10:00:00.000Z"
}
```

| Status | Body |
|---|---|
| `200` | `{ ok: true, received: "<externalId>" }` |
| `400` | `Error` — missing `externalId`/`title` or invalid JSON |

On success the task is published to the bus as `task.received`.

### `POST /module`

Request:

```json
{ "title": "User Profile", "domain": "nestjs", "action": "add" }
```

| Field | Required | Type | Notes |
|---|---|---|---|
| `title` | yes | `string` | also drives `detectDomain`/`detectAction` fallback |
| `domain` | no | `ModuleDomain` | bypasses matcher; unknown → `400` |
| `action` | no | `ModuleAction` | bypasses matcher; unknown → `400` |

Response (`202`, run is async):

```json
{
  "ok": true,
  "runId": "run-cli-user-profile",
  "domain": "nestjs",
  "action": "add"
}
```

Errors: `400` (missing title / unknown domain or action — includes
`domains`/`actions` lists), `501` if the pipeline is not wired.

### `GET /module/:runId`

```json
{
  "ok": true,
  "state": {
    "runId": "run-cli-user-profile",
    "phase": "done",
    "externalId": "user-profile",
    "source": "cli",
    "attempts": 0,
    "action": "add"
  }
}
```

| Status | Body |
|---|---|
| `200` | `{ ok: true, state: IPipelineState }` |
| `404` | `Error` — no such run |
| `501` | `Error` — state store not wired |

## `POST /module/:runId/stop`

Stops an active run. The stop is async: the endpoint acknowledges the signal,
the run finalises to `cancelled` and announces `pipeline.cancelled`.

```bash
curl -X POST http://127.0.0.1:8787/module/run-cli-user-profile/stop
# { "ok": true, "runId": "run-cli-user-profile", "stopped": true }
```

| Status | Body |
|---|---|
| `200` | `{ ok: true, runId, stopped: true }` — signal delivered to an active run |
| `404` | `Error` — no such run |
| `409` | `Error` + `state` — run exists but is not active (already terminal) |
| `501` | `Error` — pipeline or store not wired |

## Error contract

Every non-`2xx` body is `{ ok: false, error: string }` with optional hint
lists so clients can correct their request:

```ts
interface Error {
  ok: false;
  error: string;
  agents?: string[];   // unknown-agent on /run
  domains?: ModuleDomain[];
  actions?: ModuleAction[];
}
```

## `GET /stream` — SSE events

`text/event-stream`, kept open with a comment ping every `15s`. The first
frame is always a `snapshot` with the buffered history (up to
`EVENT_HISTORY_LIMIT`, default 200), then live frames follow. The SSE `event`
name equals the `WorkflowEvent.type`; `data` is the JSON event plus an integer
`ts` (ms epoch).

```ts
type EntryPointIgnoreReason =
  | "unknown_binding"
  | "binding_disabled"
  | "bad_signature"
  | "misconfigured"
  | "filter_mismatch"
  | "matcher_reject"
  | "duplicate_delivery";

type WireEvent =
  | { type: "task.received"; task: IWorkflowTask }
  | { type: "pipeline.started"; runId: string; task: IWorkflowTask; action: ModuleAction; domain: ModuleDomain }
  | { type: "pipeline.phase"; runId: string; phase: PipelinePhase }
  | { type: "pipeline.done"; runId: string }
  | { type: "pipeline.failed"; runId: string; error: string }
  | { type: "pipeline.cancelled"; runId: string }
  | { type: "pipeline.delivered"; runId: string; commit?: string; pushed: boolean }
  | { type: "pipeline.delivery_failed"; runId: string; error: string }
  | { type: "entrypoint.ignored"; hookId: string | null; reason: EntryPointIgnoreReason; detail?: string };
```

| Frame type | data |
|---|---|
| `snapshot` | `{ events: WireEvent[], ts }` — replay of buffered history |
| `task.received` | `{ type, task, ts }` |
| `pipeline.started` | `{ type, runId, task, action, domain, ts }` — run begins |
| `pipeline.phase` | `{ type, runId, phase, ts }` |
| `pipeline.done` | `{ type, runId, ts }` |
| `pipeline.failed` | `{ type, runId, error, ts }` |
| `pipeline.cancelled` | `{ type, runId, ts }` — run stopped via `POST /module/:runId/stop` |
| `pipeline.delivered` | `{ type, runId, commit?, pushed, ts }` — delivery committed/pushed the run |
| `pipeline.delivery_failed` | `{ type, runId, error, ts }` |
| `entrypoint.ignored` | `{ type, hookId, reason, detail?, ts }` — webhook ingress rejected |

```bash
curl -N http://127.0.0.1:8787/stream
```

Recovery is built-in: on reconnect the server re-sends the snapshot from its
buffer, so a late client converges to the current run state.