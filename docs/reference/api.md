# HTTP API

The webhook (`bun run webhook`) serves the platform API on `PORT` (default
`8787`). Responses are JSON.

For the formal wire schemas (types, field tables, machine-readable spec) see
**[API Contracts](/reference/contracts)** and the OpenAPI 3.0 file
[`/openapi.yaml`](/openapi.yaml).

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness probe → `{ ok: true }` |
| `GET` | `/agents` | List agents known to the server |
| `GET` / `POST` | `/run` | One-off agent run (single *Test* prompt) |
| `POST` | `/task` | Ingest a task → publishes `task.received` |
| `POST` | `/module` | Start a module pipeline by title → `202` with `runId` |
| `GET` | `/module/:runId` | Persisted pipeline state for a run |
| `POST` | `/module/:runId/stop` | Stop an active run → `cancelled` via `pipeline.cancelled` |
| `GET` | `/stream` | SSE stream of platform events (`snapshot` + live) |

## GET /health

```bash
curl http://127.0.0.1:8787/health
# { "ok": true }
```

## GET /agents

```bash
curl http://127.0.0.1:8787/agents
# { "ok": true, "agents": ["build", "unit-test", "refactor", …] }
```

## GET / POST /run

Runs the workflow prompt with an agent. The agent can be supplied as a query
parameter or a JSON body field. Unknown agents are rejected with `400` and the
known list.

```bash
curl "http://127.0.0.1:8787/run?agent=refactor"
curl -X POST http://127.0.0.1:8787/run -d '{"agent":"build"}'
```

Response: `{ ok, prompt, agent, sessionId, response, durationMs }`.

## POST /task

Ingests a task into the bus. Requires `externalId` and `title`:

```bash
curl -X POST http://127.0.0.1:8787/task \
  -H 'content-type: application/json' \
  -d '{"externalId":"t-42","source":"web","title":"Create billing module"}'
# { "ok": true, "received": "t-42" }
```

## POST /module

Starts a module pipeline run from a module *title* without going through the
**matcher**:

```bash
curl -X POST http://127.0.0.1:8787/module \
  -H 'content-type: application/json' \
  -d '{"title":"User Profile","domain":"nestjs","action":"add"}'
# 202 { "ok": true, "runId": "run-cli-user-profile", "domain": "nestjs", "action": "add" }
```

- `title` is required; `domain` and `action` are optional and are otherwise
  auto-detected (`detectDomain`/`detectAction`).
- Unknown `domain`/`action` values → `400` with the allowed lists.
- The run is **async** — the endpoint returns `202` immediately; track it via
  `GET /module/:runId`.

## GET /module/:runId

Returns the persisted pipeline state for a run:

```bash
curl http://127.0.0.1:8787/module/run-cli-user-profile
# { "ok": true, "state": { "runId": "…", "phase": "done", "attempts": 0, "action": "add", … } }
```

`404` if no run with that id exists yet.

## POST /module/:runId/stop

Stops an active pipeline run. The stop is acknowledged synchronously; the run
finalises to `cancelled` and announces `pipeline.cancelled` on the bus:

```bash
curl -X POST http://127.0.0.1:8787/module/run-cli-user-profile/stop
# { "ok": true, "runId": "run-cli-user-profile", "stopped": true }
```

`404` if no run with that id exists; `409` (with the current `state`) if the
run is known but not active — already `done`, `failed` or `cancelled`.

## GET /stream

Server-Sent-Events stream powering the web dashboard (see the
[web dashboard](/reference/web)). Emits a `snapshot` replay first, then live
events; delimited by `EVENT_HISTORY_LIMIT` and `SSE_PING_MS` (15s):

```bash
curl -N http://127.0.0.1:8787/stream
event: snapshot
data: {"events":[…],"ts":…}

event: pipeline.phase
data: {"type":"pipeline.phase","runId":"run-cli-user-profile","phase":"implementation","ts":…}
```

The full wire contracts of the frames live in
[API Contracts](/reference/contracts#get-stream--sse-events).