# Environment Variables

All configuration is injected through environment variables.

## opencode connection

| Variable | Default | Purpose |
|---|---|---|
| `OPENCODE_SERVER_URL` | — | URL существующего сервера (например `http://127.0.0.1:4096`); пуст или недоступен → платформа стартует деградированно, агентские вызовы бросают `OpencodeConnectionError` |
| `OPENCODE_DIRECTORY` | — | Project directory (attach mode) |
| `OPENCODE_SERVER_PASSWORD` | — | Password for a protected server (HTTP Basic Auth) |
| `OPENCODE_SERVER_USERNAME` | `opencode` | Basic Auth username |

## Webhook

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | Webhook port |
| `EVENT_HISTORY_LIMIT` | `200` | SSE snapshot replay window (bounded event history in the bus) |
| `DELIVERY_DEDUP_LIMIT` | `500` | Max tracked delivery ids for webhook de-duplication |

## Task sources & watcher

| Variable | Default | Purpose |
|---|---|---|
| `TASK_SOURCE` | `file` | Source for `bun run watch`: `file` or `trello` |
| `TASK_SOURCE_FILE` | `tasks.json` | JSON file of tasks for the `file` source |
| `TASK_POLL_INTERVAL_MS` | `30000` | Watcher poll interval |
| `STATE_DIR` | `~/.local/state/opencode-workflow` | State directory (pipeline runs + processed ids) |

### Trello

| Variable | Default | Purpose |
|---|---|---|
| `TRELLO_API_KEY` | — | Trello API key (required for `TASK_SOURCE=trello`) |
| `TRELLO_TOKEN` | — | Trello token (required) |
| `TRELLO_BOARD` | first open board | Board name |
| `TRELLO_INBOX_LIST` | `Inbox` | List to fetch tasks from |
| `TRELLO_DONE_LIST` | `Done` | List used by `ackTask` (move card) |

## Vault (per-workflow secrets)

AES-256-GCM, one scope per workflow id (`rt.vault.get(id, KEY)`).
Changes (CLI/HTTP/manual) are visible on the next run — no restart.
Only key rotation needs an env update + restart.

| Variable | Default | Purpose |
|---|---|---|
| `VAULT_MASTER_KEY` | — | base64 32B master key (prod: `docker run -e`); dev fallback: auto-generated `$STATE_DIR/vault/master.key` 0600 |
| `VAULT_TOKEN` | — | Bearer token for `/vault/*` HTTP API (unset = API disabled); prod manual setup |
| `VAULT_DIR` | `$STATE_DIR/vault` | Vault directory (`vault.json` 0600, `audit.log`, dev `master.key`) — mount as volume in Docker |

```bash
bun run vault set trello-move-notify TELEGRAM_BOT_TOKEN=...  # or KEY (value from stdin)
bun run vault list trello-move-notify                        # key names only
bun run vault rotate                                         # new master key via stdin
# HTTP (VAULT_TOKEN required): PUT /vault/<id>/<KEY> { "value": "..." }
```

## Module pipeline

| Variable | Default | Purpose |
|---|---|---|
| `PIPELINE_MAX_RETRIES` | `3` | Verification-retry budget; exhaustion → `failed` |
| `PHASE_TIMEOUT_MS` | `1200000` (20 min) | Per-phase model budget; expiry fails the run |
| `PHASE_SETTLE_MS` | `60000` | Silence window that completes a phase for providers missing step-finish events |

## Workflows directory & hot-reload

Custom compiled workflow artifacts live under `WORKFLOWS_DIR` (default
`workflows` relative to the platform's working directory). Each artifact is a
folder `<id>/{index.js, manifest.json}` produced by `bun run build-workflow`
(see [Custom Workflows](/platform/workflows)). On start and after every
`POST /internal/workflows/reload` the platform diffs the directory and emits
`workflow.registered`, `workflow.updated`, `workflow.removed`, and
`workflow.error` bus events (visible in the SSE stream and the web dashboard).

The `watch-workflows` sidecar polls `WORKFLOWS_DIR`, detects directory-level
changes, and hits the internal reload endpoint with the appropriate token.

| Variable | Default | Purpose |
|---|---|---|
| `WORKFLOWS_DIR` | `workflows` | Directory containing compiled workflow artifacts |
| `WATCHER_POLL_MS` | `2000` | watch-workflows poll interval |
| `RELOAD_TOKEN` | (empty) | When set, the internal `/internal/workflows/reload` endpoint requires the `x-reload-token` header with this value; loopback is denied when set |

```bash
# example: start the sidecar in production alongside the webhook
WORKFLOWS_DIR=/app/workflows PORT=8787 RELOAD_TOKEN=$(openssl rand -hex 16) bun run watch-workflows
```

Gate rules applied at load:

- `manifest.json` must be valid JSON with `format`, `id`, `label`, and
  `sdkVersion`.
- `format` must equal the current `workflowFormat` constant (`1`).
- `sdkVersion` must match the SDK version the platform was compiled against.
  After upgrading the SDK or platform, rebuild artifacts via
  `bun run build-workflow`.
- The artifact directory name must match the `id` in the manifest.
- Missing or misconfigured artifacts are skipped and published as
  `workflow.error` (they never crash the platform).

## Delivery

The delivery step is opt-in and runs in the current working directory
(`PROJECT_DIR` when set). It commits the finished run and conditionally pushes
it. Prerequisites from the pack `.opencode/` apply (see
[/reference/pack](/reference/pack)).

| Variable | Default | Purpose |
|---|---|---|
| `DELIVERY_ENABLED` | `0` | `1` → subscribe `pipeline.done` and commit the run's changes |
| `DELIVERY_PUSH` | `0` | `1` → also push to the remote after committing |
| `PROJECT_DIR` | cwd | Repository the delivery commits into |

## Task reactors (workflow → events)

A custom workflow can react to incoming tasks (e.g. new Trello cards from the
polling source): set a comma-separated list of workflow ids and the platform
starts those workflows on every `task.received` (the built-in module matcher
keeps working in parallel).

| Variable | Default | Purpose |
|---|---|---|
| `WORKFLOW_ON_TASK_RECEIVED` | (empty) | CSV-список id workflow-реакторов (Trello-карточка → Task), запускаемых на каждый `task.received` |
| `WORKFLOW_ON_TASK_MOVED` | (empty) | CSV-список id workflow-реакторов, запускаемых на каждый `task.moved` (перемещение карточки между листами; в `task.meta.move` лежат `fromList`/`toList`) |

Example — «новый Trello-тикет → Telegram»:

```bash
cd apps/platform
bun run build-workflow                      # trello-notify артефакт
TRELLO_API_KEY=... TRELLO_TOKEN=... \
TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=@workhub \
WORKFLOW_ON_TASK_RECEIVED=trello-notify \
TASK_SOURCE=trello \
bun run watch                               # Trello → task.received
bun run webhook                             # платформа (реестр + роутер)
```

The `TelegramConnector` (service `telegram`) sends via Bot API —
`TELEGRAM_BOT_TOKEN` required, `TELEGRAM_CHAT_ID` is the default chat
(overridable per call with `chat_id`).

## Webhook bindings & secrets

Webhook bindings are stored under `STATE_DIR/hooks/`. A binding may pin an
env variable by name (`secretEnv`) that holds its HMAC secret — the variable
must be set in the webhook process's environment at ingest time. Example:

```bash
export GITHUB_WEBHOOK_SECRET="$(openssl rand -hex 32)"
# POST /hooks  { "source": "github-ci", "provider": "github", "secretEnv": "GITHUB_WEBHOOK_SECRET" }
```

Ingress verifies the `x-hub-signature-256` HMAC SHA-256 over the **raw body**.

## Public URL (prod vs local dev)

`PUBLIC_URL` is the public base URL the platform is reachable at
(`https://host:port`); `register.sh` appends `/hooks/<bindingId>` and
registers the Trello webhook against it.

- **Prod (container)**: set `PUBLIC_URL` manually via env
  (`docker run -e PUBLIC_URL=https://host`) — no ngrok, no pm2. `register.sh`
  takes it from env as long as `<PUBLIC_URL>/health` responds.
- **Dev (local)**: the tunnel is owned by pm2 (app `tunnel` in
  `ecosystem.config.cjs`, ngrok agent on `:4040`); `register.sh` falls back to
  the live `public_url` from `:4040/api/tunnels` when env is unset. pm2 and
  `tunnel.sh` are dev-only and are excluded from the Docker image
  (`.dockerignore`).

## Secrets

Platform secrets (`TRELLO_*`, opencode server auth) are **never** placed in the
repository — pass them only as environment variables. In Docker use
`docker run -e KEY=value`.

## Notes

- `LOG_LEVEL`: `silent` | `error` | `warn` | `info` (default) | `debug`. Controls
  the console logger used by watch, webhook and workflow runs: `info` shows
  poll/run/command outcomes, `debug` adds per-node traces in the graph engine.
- In attach mode (`OPENCODE_SERVER_URL`) the running server's own config and
  model apply. The platform never starts its own opencode server (UNIX: no
  connection is an execution error, not a self-start) — for local demo the
  server runs as a separate pm2 app (`opencode`, see `ecosystem.config.cjs`),
  working inside `apps/platform/opencode-workspace/`.