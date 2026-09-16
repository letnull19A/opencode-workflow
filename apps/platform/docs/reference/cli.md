# CLI Commands

All commands run through Bun (`bun run …`), except `start`, which maps to
`bun src/cli/index.ts`.

## One-off agent run

```bash
bun run start [agent]
```

Sends the workflow prompt to the given agent (default: `build`) against an
opencode server, prints the session id and the response, then exits.

```bash
bun run start refactor        # use the refactor agent
bun run start                 # default build agent
```

## Module run (by name)

```bash
bun run start module "<module title>" [--domain <d>] [--action <a>]
```

Starts the module pipeline directly for a module *named in the command*. Action
and domain are auto-detected from the title unless overridden:

```bash
bun run start module "User Profile"
bun run start module "User Profile" --domain nestjs --action add
```

Phase events print to stdout (`[phase] run-…: spec` …), progress persists to
the state store, and the final line is the terminal state:

```
[result] run-cli-user-profile: done
```

Run the pipeline against a different project by changing the working directory
(an opencode server is started there), or point to an existing server with
`OPENCODE_SERVER_URL`.

## Build workflow artifacts

Compiles `workflows-src/*.ts` (or explicit files) into self-contained artifacts
under `WORKFLOWS_DIR` (default `workflows`). For each source it runs
`tsc --noEmit` (scoped to `workflows-src/tsconfig.json`), then bundles with
`Bun.build` — the SDK is inlined, and a `manifest.json` is written for the
platform's load-time gate.

```bash
bun run build-workflow                          # compile all workflows-src/*.ts
bun run build-workflow workflows-src/feat-x.ts  # compile a single file
WORKFLOWS_DIR=dist/workflows bun run build-workflow
```

Output: `<WORKFLOWS_DIR>/<id>/index.js` + `manifest.json`.

## Task watcher

```bash
bun run watch
```

Polls a task source (`TASK_SOURCE=file|trello`) and feeds tasks to the pipeline
through the matcher. See [Task Sources & Events](/platform/tasks).

## Workflow watcher sidecar

```bash
bun run watch-workflows
```

Polls `WORKFLOWS_DIR` and, on any change, hits
`POST /internal/workflows/reload` so the running platform re-indexes the
registry and emits `workflow.*` events. The sidecar keeps retrying when the
platform is down (no crash loop). Authenticate with `RELOAD_TOKEN` in
production.

## Webhook

```bash
bun run webhook         # :8787
PORT=9000 bun run webhook
```

Starts the HTTP API — see [HTTP API](/reference/api).

## Vault

Per-workflow secrets (scope = workflow id). The value never appears in
logs — only scope/key names:

```bash
bun run vault set trello-move-notify TELEGRAM_BOT_TOKEN=...  # or KEY (value from stdin)
bun run vault get trello-move-notify TELEGRAM_BOT_TOKEN      # value to stdout
bun run vault list trello-move-notify                        # key names only
bun run vault has trello-move-notify TELEGRAM_BOT_TOKEN      # yes/no
bun run vault delete trello-move-notify TELEGRAM_BOT_TOKEN
bun run vault rotate                                         # new master key via stdin
bun run vault import-env trello-move-notify apps/platform/.env
bun run vault genkey                                          # new master key to stdout
```

Master key resolution: `VAULT_MASTER_KEY` env (production, e.g.
`docker run -e`); dev fallback is an auto-generated `$STATE_DIR/vault/master.key`
(`0600`). After `rotate`, update `VAULT_MASTER_KEY` in env and restart the
process. Remote management is also available over
[HTTP](/reference/api#vault-secrets-per-workflow) with `VAULT_TOKEN`.

## Tooling

| Command | Purpose |
|---|---|
| `bun run typecheck` | `tsc --noEmit` (TypeScript 7, typecheck only) |
| `bun run docs:dev` | VitePress dev server |
| `bun run docs:build` | VitePress static build |
| `bun run docs:preview` | Preview the built docs site |