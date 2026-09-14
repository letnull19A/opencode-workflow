# Getting Started

## Prerequisites

- **Bun** 1.x — runtime and package manager (`bun install`, `bun run …`).
- **opencode CLI** — needed to reach an opencode server. It is used by the SDK's `createOpencodeServer` when no server is already attached (`opencode-ai` from npm, or any way you usually install opencode).
- Optionally, credentials for the task source you use:
  - Trello (`TRELLO_API_KEY`, `TRELLO_TOKEN`) for `TASK_SOURCE=trello`;
  - nothing for the built-in `file` source.

## Clone

```bash
git clone --recurse-submodules git@github.com:letnull19A/opencode-workflow.git
cd opencode-workflow
bun install
```

For an existing clone: `git submodule update --init`.

## Run

```bash
bun run start refactor                 # one-off agent run (default agent: build)
bun run start module "User Profile"    # module pipeline by title (strategy auto-detected)
bun run start module "User Profile" --domain nestjs --action add
bun run webhook                        # webhook on :8787
bun run watch                          # poll a task source, feed the pipeline automatically
bun run typecheck                      # tsc --noEmit (TypeScript 7)
```

### Run the docs site / web dashboard

```bash
bun run docs:dev        # local dev server at http://localhost:5173
bun run docs:build      # static build into docs/.vitepress/dist
bun run docs:preview    # preview the built site

cd web
bun install
bun run dev             # dashboard at http://localhost:5173 (proxies the webhook)
```

### Dev orchestration with PM2

While developing, run the whole app (webhook + dashboard) under PM2 `ecosystem.config.cjs`:

```bash
bun install             # adds pm2 as a dev dependency
bun run dev             # starts `webhook` (fork, watches src/) and `web` (Vite)
bun run dev:status      # pm2 status
bun run dev:logs        # pm2 logs --lines 100
bun run dev:restart     # restart both apps
bun run dev:save        # persist the process list (survives `pm2 resurrect`)
bun run dev:stop        # stop apps (daemon keeps running)
bun run dev:kill        # stop + kill the PM2 daemon
```

The webhook process watches `src/` and auto-restarts on backend changes; the
Vite process is `watch: false` because it carries its own HMR. If the Vite
`web` process is killed on port conflicts (e.g. `:5173` already taken, it
lands on `:5174`), check `pm2 logs web`.

## First module run

The simplest way to see the pipeline live is the module form of the CLI. It bypasses
the matcher and starts directly with the resolved domain and action:

```bash
bun run start module "Password reset"
# [module] "Password reset" -> domain: general, action: add (run-cli-password-reset)
# [phase] run-cli-password-reset: spec
# [phase] run-cli-password-reset: planning
# ...
# [result] run-cli-password-reset: done
```

The run drives opencode sessions against the project in the current working
directory. Progress persists to `<STATE_DIR>/<runId>.json` (default
`~/.local/state/opencode-workflow/`).

## Attach to a running server

By default the platform starts its own opencode server. To reuse an existing one set:

```bash
export OPENCODE_SERVER_URL=http://127.0.0.1:4096
```

If the URL is unreachable, the platform falls back to starting its own server. In
attach mode the running server's config and model are used; the self-started
server applies `permission: allow` and `reasoningEffort: minimal`.

## Next steps

- Understand the [platform architecture](/platform/architecture) and the [module pipeline](/platform/pipeline).
- Explore the [CLI](/reference/cli), [HTTP API](/reference/api) and [task sources](/platform/tasks).
- Run the [end-to-end verification](/guide/e2e) in an isolated sandbox.