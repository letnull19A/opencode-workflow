# Overview

`opencode-workflow` is a small platform-orchestrator for **module development on top of [opencode](https://opencode.ai)**. It does not replace opencode — it drives it: builds a state machine of development phases, runs each phase as a dedicated opencode agent session, verifies the result and persists progress between runs.

The codebase is written in **TypeScript 7 on Bun**. Platform code and the portable agent pack are split into two repositories:

- **This repository** — the TS7 platform: interfaces, classes, the webhook, task sources and entry points (`src/`).
- **`.opencode/`** (a git submodule wired to [`letnull19A/.opencode`](https://github.com/letnull19A/.opencode)) — the portable "brains": opencode agents, skills and slash-commands. Consumer projects clone this pack into their own `.opencode/`.

## What it does

Given a task (or a plain module title), the platform runs one of four **action strategies**:

| Strategy | Phases |
|---|---|
| `add` | spec → planning → tests → implementation → verification |
| `update` | tests → implementation → verification |
| `delete` | implementation → verification |
| `decompose` | spec → planning |

Each phase is a real opencode session with a **proxy agent** tuned for the job:

- `tests` → the [`unit-test`](/reference/pack) agent;
- `implementation` for `update`/`delete`/`decompose` → the [`refactor`](/reference/pack) agent;
- everything else → the default `build` agent.

## Key ideas

- **Contracts in `core`, logic in `impl`.** `src/core/` contains only interfaces (`I*`) and type unions. Every swappable node — task source, event bus, worker registry, state store, agent executor, module worker — is an interface with at least one implementation.
- **Strategy-driven pipeline.** `ModulePipeline` is a small state machine: it walks the phase list for the chosen action, and on verification failure returns to `tests` (add/update) or `implementation` (delete) within a retry budget.
- **Three entry points.** A single-agent CLI, a webhook with HTTP API, and a task watcher that polls a task source and feeds the pipeline automatically.
- **Live completion detection.** Phase completion is detected by polling the opencode session (a `completed` flag on the latest message, or stable output for `PHASE_SETTLE_MS`) — runs finish even for providers that never emit a dedicated step-finish event.

## Repository layout

```
src/core/       Interfaces and type unions only (IAgentExecutor, IWorkflowTask, …)
src/impl/       Implementations (ModulePipeline, ModuleMatcher, workers, executors, …)
src/http/       HttpApiController + main.ts (wire from env)
src/cli/        Point entries (agent run, module run, task watcher)
src/workers/    Re-exports of the domain workers
docs/           This documentation site (VitePress)
.opencode/      Pack submodule: agents, skills, slash-commands
Dockerfile      Containerised webhook
```

Continue with the [Getting Started](/guide/getting-started) guide.