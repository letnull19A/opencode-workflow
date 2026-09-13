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

## Secrets

Platform secrets (`TRELLO_*`, opencode server auth) are **never** placed in the
repository — pass them only as environment variables. In Docker use
`docker run -e KEY=value`.

## Notes

- In attach mode (`OPENCODE_SERVER_URL`) the running server's own config and
  model apply; `permission: allow` and `reasoningEffort: minimal` are only
  applied to a **self-started** server.