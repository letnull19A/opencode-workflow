# The .opencode Pack

`.opencode/` is a git submodule — the **portable brains** of the platform. It is
a standalone opencode configuration cloned, by convention, into a consumer
project (`.opencode/` inside the consumer repo root). The platform uses the same
pack for its own runs; the E2E sandbox links it the same way a consumer would.

Repo: [`letnull19A/.opencode`](https://github.com/letnull19A/.opencode).

::: tip Default agent
The pack sets `default_agent: build`, which is why the pipeline's "everything
else" fallback resolves to `build`.
:::

## Layout

| Path | Content |
|---|---|
| `opencode.json` | server config: default agent, MCP servers, permission allowlist |
| `agent/` | subagents — `unit-test`, `refactor`, `trello-task`, `react-fix`, `component-builder`, `issue-writer`, `screenshot-report` |
| `commands/` | slash-commands — `/commit`, `/push`, `/sync`, `/new-task`, `/fix`, `/new-module` |
| `skills/` | skills — `commit`, `trello-task`, `react-fix`, `tunnel-manager`, `module-develop` |
| `scripts/` | deterministic helpers (git push, Trello cards, issue writer, tunnels, screenshots, react-fix) |
| `AGENTS.md` | pack rules (agent behaviour, per-pipeline "never do" list) |

## Config

- `default_agent: build`.
- MCP: `trello` (local), `context7` (remote, docs), `dokploy` (deploy).
- Permission allowlist for pack scripts (`bash .opencode/scripts/tunnel/run.sh*`,
  `push/run.sh*`, `sync/run.sh*`, `react-fix/*`) — these run without prompts;
  the agents never shell out to the underlying tools themselves.

## Agents used by the pipeline

| Agent | Used for | Notes |
|---|---|---|
| `unit-test` | `tests` phase | framework-agnostic; framework syntax strictly from Context7 |
| `refactor` | `implementation` of `update`/`delete`/`decompose` | |
| `build` | everything else (default) | |

## Slash-commands

| Command | What it does |
|---|---|
| `/commit` | Atomic Conventional Commits — plan + explicit "yes", groups changes by intent |
| `/push` | Pushes committed commits only (never `git add`/`commit`/`--force`); uncommitted stays local |
| `/sync` | Pulls via `pull --rebase --autostash`; rebase conflicts go back to the user |
| `/new-task` | Files a Trello card with a project tag (draft + explicit "yes") |
| `/fix` | Minimal React style/markup fix by CSS class (only after "what + where" is confirmed) |
| `/new-module` | Module development via the `module-develop` skill, orchestrated by `build` |

## module-develop (skill behind `/new-module`)

The portable twin of the platform's `ModulePipeline`: same strategy names, same
phase maps, same retry budget. It is designed to run in an interactive opencode
session on any consumer project:

1. **Detect strategy** from the request — priority `decompose → delete →
   update → add`.
2. **Detect domain** from the repo files (nest-cli.json, `*.csproj`, package
   managers) — never from memory.
3. **Pick the phase map** for the strategy and execute each phase.
4. **Delegate** — `tests` → `@unit-test`; implementation of
   update/delete/decompose → `@refactor`; add → the `build` agent itself.
5. **Verify** with the project's *real* test runner; on red, return to
   `tests` (add/update) or `implementation` (delete/decompose) up to
   `PIPELINE_MAX_RETRIES`.

Like every pack pipeline it is conservative: show a compact plan (strategy,
domain, phases) and wait for an explicit "yes" before making changes, keep git
out of the picture (`/commit`, `/push`), and never write secrets into files.

## Pack pipelines' house rules

Each slash-command owns its "never do" list (in the pack's `AGENTS.md`), e.g.:

- **push** — only `bash .opencode/scripts/push/run.sh`; never manual git.
- **commit** — commits only via the `commit` skill, plan + explicit "yes".
- **trello** — Trello API only through `scripts/trello-task/*`; names resolved
  from real board data.
- **react-fix** — classes found only by `scripts/react-fix/find-class.sh`.