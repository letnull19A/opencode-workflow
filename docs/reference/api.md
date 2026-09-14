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
| `GET` | `/hooks` | List webhook bindings |
| `POST` | `/hooks` | Create a webhook binding → `201` with ingress `url` |
| `POST` | `/hooks/:hookId` | Webhook ingress → entrypoint node → pipeline run |
| `DELETE` | `/hooks/:hookId` | Remove a webhook binding |
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

## GET /hooks

Lists webhook bindings. Secrets are never returned — only the *name* of the
env variable (`secretEnv`) holding the HMAC secret:

```bash
curl http://127.0.0.1:8787/hooks
# { "ok": true, "hooks": [{ "id": "hk_mre3xo6q", "source": "github", "provider": "github", "enabled": true, "createdAt": "…" }] }
```

## POST /hooks

Creates a webhook binding (persisted under `STATE_DIR/hooks/`):

```bash
curl -X POST http://127.0.0.1:8787/hooks \
  -H 'content-type: application/json' \
  -d '{"source":"github-ci","provider":"github","action":"add","secretEnv":"GITHUB_WEBHOOK_SECRET"}'
# 201 { "ok": true, "id": "hk_mre3xo6q", "url": "/hooks/hk_mre3xo6q" }
```

- `source` (required) and `provider` (`github` | `generic`) are mandatory;
  `action`/`domain` pin the module strategy (else detected from the payload);
  `secretEnv` names the env variable with the HMAC secret; `enabled` defaults
  to `true`.

## POST /hooks/:hookId

Webhook ingress. The raw body is HMAC-SHA256-verified (header
`x-hub-signature-256`) when the binding pins a `secretEnv`, delivery ids are
de-duplicated (`x-github-delivery` / `delivery_id`, bounded by
`DELIVERY_DEDUP_LIMIT`), then a module run is started through the webhook
entrypoint node:

```bash
curl -X POST http://127.0.0.1:8787/hooks/hk_mre3xo6q \
  -H 'content-type: application/json' \
  -d '{"externalId":"card-7","title":"Add audit trail module"}'
# { "ok": true, "received": true, "started": true }
```

Every rejection publishes `entrypoint.ignored` to the bus — nothing is
silently dropped:

| status | reason (`entrypoint.ignored`) | meaning |
|---|---|---|
| `404` | `unknown_binding` / `binding_disabled` | no such binding, or binding disabled |
| `500` | `misconfigured` | `secretEnv` variable missing from env |
| `401` | `bad_signature` | HMAC mismatch or missing header |
| `200` (duplicate) | `duplicate_delivery` | delivery id already seen (`started=false`) |
| `200` | — | accepted; run id comes via `pipeline.started` on the bus |

## DELETE /hooks/:hookId

Removes a binding (and its cached entrypoint node):

```bash
curl -X DELETE http://127.0.0.1:8787/hooks/hk_mre3xo6q
# { "ok": true, "removed": "hk_mre3xo6q" }
```

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