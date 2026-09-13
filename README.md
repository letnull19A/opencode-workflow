# opencode-workflow

Demo of working with opencode through `@opencode-ai/sdk` on Bun: send a prompt, wait for the answer, exit. Custom agents come from `.opencode/` (a submodule).

## Files

- `src/impl/OpencodeAgentExecutor.ts` — connection to opencode (attach or self-start), auto-approval of permissions, run of the hardcoded `"Test"` prompt.
- `src/impl/ModulePipeline.ts` — module-building state machine: `spec → planning → tests → implementation → verification`; on verification FAIL → back to `tests`, budget of retries (`PIPELINE_MAX_RETRIES`), on exhaustion → `failed`; persists state via `IPipelineStateStore`.
- `src/impl/ModuleMatcher.ts` — subscribes to `task.received`, matches “create new module” tasks via `defaultMatch`, detects domain (`nestjs`/`dotnet`/`frontend`/`general`) and starts the pipeline.
- `src/core/worker.ts` + `src/impl/BaseModuleWorker.ts` — `IModuleWorker` contract and base class; domain workers: `NestJSModuleWorker` (jest), `DotNetModuleWorker` (dotnet test), `GeneralModuleWorker` (fallback). Re-exported from `src/workers/index.ts`.
- `src/impl/ConfigWorkerRegistry.ts` — `IWorkerRegistry`: domain+action → `IModuleWorker[]` (exact domain wins, `general` is the fallback).
- `src/impl/TaskWatcher.ts` — poll bridge: new tasks from a source → `task.received` event → ack; processed state in `<STATE_DIR>/processed.json`.
- `src/impl/TrelloTaskSource.ts` / `src/impl/FileTaskSource.ts` — `ITaskSource` implementations (Trello REST / local JSON).
- `src/cli/index.ts` — CLI: `bun run start [agent]`.
- `src/cli/watcher.ts` — watcher entry: `bun run watch` (polls `TASK_SOURCE`: `trello` or `file`).
- `src/http/HttpApiController.ts` — HTTP: `GET /health`, `GET /agents`, `GET/POST /run(?agent=|{"agent":...})`, `POST /task` (ingest → `task.received`).
- `src/core/` — contracts only (`I*` interfaces and type unions), no logic.
- `.opencode/` — submodule `letnull19A/.opencode` with agents, commands and skills.

## Setup

```bash
git clone --recurse-submodules git@github.com:letnull19A/opencode-workflow.git
cd opencode-workflow
pnpm install
```

For an existing clone: `git submodule update --init`.

## Run

```bash
bun run start refactor       # single run with the refactor agent (default is build)
bun run webhook              # webhook on :8787
PORT=9000 bun run webhook
bun run watch                # poll task source (TASK_SOURCE=file|trello) → events → ack
bun run typecheck            # tsc --noEmit (TypeScript 7, typecheck-only)
```

## Env

| Variable | Purpose |
|---|---|
| `OPENCODE_SERVER_URL` | attach to a running server (e.g. `http://127.0.0.1:4096`); if empty or unreachable, a new server is started |
| `OPENCODE_DIRECTORY` | project for attach mode (optional) |
| `OPENCODE_SERVER_PASSWORD` | password for a protected server (HTTP Basic Auth) |
| `OPENCODE_SERVER_USERNAME` | auth username (default `opencode`) |
| `PORT` | webhook port (default `8787`) |
| `TASK_SOURCE` | task source for `bun run watch` (`file` default, `trello`) |
| `TASK_SOURCE_FILE` | JSON file of tasks for `file` source (default `tasks.json`) |
| `TASK_POLL_INTERVAL_MS` | watcher poll interval (default `30000`) |
| `STATE_DIR` | state directory (default `~/.local/state/opencode-workflow`) |
| `TRELLO_API_KEY`, `TRELLO_TOKEN` | Trello credentials (required for `TASK_SOURCE=trello`) |
| `TRELLO_BOARD` | Trello board name (default: first open board) |
| `TRELLO_INBOX_LIST` | inbox list to fetch tasks from (default `Inbox`) |
| `TRELLO_DONE_LIST` | list for ack (move card, default `Done`) |
| `PIPELINE_MAX_RETRIES` | verification-retry budget for the module pipeline (default `3`) |

In attach mode the running server's config and model are used, not the local ones (`permission: allow` and `reasoningEffort: minimal` apply only to a self-started server).

## E2E (NestJS sandbox)

A smoke E2E runs the pipeline against a real opencode server from an isolated sandbox dir:

```bash
mkdir -p /tmp/nest-sandbox/src && cd /tmp/nest-sandbox && npm init -y
# add a sample task and run the pipeline (view phase events on stdout)
bun --offline scripts/e2e/module-pipeline.ts   # or inline with a real executor
```

Expected flow: `spec → planning → tests → implementation → verification → done` (or `failed` if the suite never passes), intermediates persisted in the pipeline state store. See `src/impl/ModulePipeline.ts` for phase semantics.
