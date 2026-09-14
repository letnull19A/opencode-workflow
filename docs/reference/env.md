# Environment Variables

All configuration is injected through environment variables.

## opencode connection

| Variable | Default | Purpose |
|---|---|---|
| `OPENCODE_SERVER_URL` | — | Attach to a running server (e.g. `http://127.0.0.1:4096`); empty or unreachable → self-start |
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

## Module pipeline

| Variable | Default | Purpose |
|---|---|---|
| `PIPELINE_MAX_RETRIES` | `3` | Verification-retry budget; exhaustion → `failed` |
| `PHASE_TIMEOUT_MS` | `1200000` (20 min) | Per-phase model budget; expiry fails the run |
| `PHASE_SETTLE_MS` | `60000` | Silence window that completes a phase for providers missing step-finish events |

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

## Webhook bindings & secrets

Webhook bindings are stored under `STATE_DIR/hooks/`. A binding may pin an
env variable by name (`secretEnv`) that holds its HMAC secret — the variable
must be set in the webhook process's environment at ingest time. Example:

```bash
export GITHUB_WEBHOOK_SECRET="$(openssl rand -hex 32)"
# POST /hooks  { "source": "github-ci", "provider": "github", "secretEnv": "GITHUB_WEBHOOK_SECRET" }
```

Ingress verifies the `x-hub-signature-256` HMAC SHA-256 over the **raw body**.

## Secrets

Platform secrets (`TRELLO_*`, opencode server auth) are **never** placed in the
repository — pass them only as environment variables. In Docker use
`docker run -e KEY=value`.

## Notes

- In attach mode (`OPENCODE_SERVER_URL`) the running server's own config and
  model apply; `permission: allow` and `reasoningEffort: minimal` are only
  applied to a **self-started** server.