# Custom Workflows

The platform is a workflow **orchestrator**, not a single pipeline. Beside the
built-in `module` workflow (the multi-agent module-development pipeline), you
can load **custom workflows**: compiled artifacts that the platform executes
with its own graph engine (`NodeGraphBuilder` + `DepthFirstNodeRunner`).

The contract lives in the **`@opencode-workflow/sdk`** package (part of this
pnpm workspace): workflow *authors* write against the SDK; the *engine* stays on
the platform.

## Where things live

| Path | What goes there |
|---|---|
| `workflows-src/` | TypeScript sources of custom workflows (one file per workflow, `export default defineWorkflow(...)`) |
| `workflows/` | Compiled artifacts: `<id>/index.js` + `<id>/manifest.json` (gitignored, copied/deployed separately) |
| `packages/sdk/` | The SDK the sources import (`@opencode-workflow/sdk`) |
| `apps/platform/src/engine/` | The graph engine that executes workflow specs at runtime |

The **webhook process (`bun run webhook`)** owns the registry: it registers the
built-in `module` workflow and, on start, loads every artifact under
`WORKFLOWS_DIR`. The **watcher sidecar (`bun run watch-workflows`)** keeps the
loaded set in sync with the directory at runtime.

## My first workflow

```ts
// workflows-src/release-bump.ts
import { defineWorkflow, graph, node, session } from "@opencode-workflow/sdk";
import type { IWorkflowRuntime, IWorkflowTask } from "@opencode-workflow/sdk";

interface Data { task: IWorkflowTask; ok: boolean; }

export default defineWorkflow<Data>({
  id: "release-bump",
  label: "Release bump",
  phases: ["analyze", "bump", "verify"],
  seed: (task) => ({ task, ok: false }),
  create: (rt: IWorkflowRuntime) =>
    graph<Data>("analyze", [
      node<Data>("analyze", {
        run: (ctx) => session(rt, ctx, `Analyse: ${ctx.data.task.title}`, "build"),
      }, { outgoing: ["bump"] }),
      node<Data>("bump", {
        run: async (ctx) => { ctx.data.ok = true; return ctx; },
      }, { outgoing: ["verify"] }),
      node<Data>("verify", {
        run: (ctx) => ctx,
      }, { outgoing: ["bump"], condition: (ctx) => !ctx.data.ok }),
    ]),
});
```

Compile, wait for the watchdog to pick it up (or trigger the reload endpoint),
and start it:

```bash
cd apps/platform
bun run build-workflow

# in another terminal (or pm2): the platform + the sidecar
bun run webhook &
bun run watch-workflows &

curl -X POST http://127.0.0.1:8787/workflow/release-bump \
  -H 'content-type: application/json' \
  -d '{"title":"Release 1.1.0"}'
# 202 { "ok": true, "workflow": "release-bump", "runId": "run-cli-release-1-1-0" }
```

## The definition contract

`IWorkflowDefinition<TData>` (see `packages/sdk/src/workflow/definition.ts`):

- `id` — registry key and route id (`[a-z0-9-]`); must match the artifact folder.
- `label` — human name for dashboards and hook forms.
- `phases?` — optional banner phases (shown on the dashboard).
- `seed(task)` — initial data of the run.
- `create(rt)` — returns the graph (specs). `rt` exposes injected services:
  - `rt.executor` — `IAgentExecutor` (run agent sessions, with `signal` for cancellation),
  - `rt.commands` — `ICommandExecutor` (connectors: `trello`, `github`, `opencode`),
  - `rt.bus` — platform event bus.

Types are validated **at build time** (`tsc --noEmit` inside `build-workflow`).
At runtime only the *contract gate* is checked (`format` + `sdkVersion` in
`manifest.json`); the code itself is trusted platform-adjacent code.

See `packages/sdk/src/dsl/graph.ts` for the tiny DSL: `node(id, executor, opts)`
(`outgoing`, `condition`), `graph(entryId, specs)`, and `session(rt, ctx, prompt, agent?)`
which runs an agent and honours `ctx.signal` for cancellation.

## Lifecycle, events & monitoring

- Loading artifacts is **isolated**: a broken workflow publishes
  `workflow.error` and is skipped — other workflows and the platform keep running.
- Directory diffs announce `workflow.registered`, `workflow.updated`,
  `workflow.removed` on the bus and therefore on the SSE `/stream` -> dashboard.
- Runs publish the same pipeline events as `module`:
  `pipeline.started` (with `workflow` field), `pipeline.phase`,
  `pipeline.done`, `pipeline.failed`, `pipeline.cancelled`, and persist
  state (`workflow` field) via the state store.
- `POST /workflow/:id/:runId/stop` aborts via `AbortSignal`; the runner turns an
  abort into `cancelled`.

## Updating a workflow

1. Edit the source under `workflows-src/`.
2. `bun run build-workflow` (rewrites the artifact folder; mtime diff triggers
   `workflow.updated`).
3. The watcher sidecar calls the reload endpoint within `WATCHER_POLL_MS`.

Run-time state is never carried between artifact reloads; in-flight runs finish
with the previously loaded code.

## Writing guides

- Keep node execution idempotent — the engine may revisit nodes (cycles are
  budgeted); make progress via fields in `ctx.data`.
- Prefer `session()` over raw `rt.executor` calls when you want cancellation to
  flow from `stop`.
- Publish structured progress via `rt.bus.publish({ type: "pipeline.phase", runId, phase })`.

## Task reactor: Trello → Telegram

A workflow can **react to incoming tasks** (`task.received`, i.e. new Trello
cards from the polling source, HTTP `/task`, ...) without touching the module
matcher: set `WORKFLOW_ON_TASK_RECEIVED=<id>` and the platform starts that
workflow for every task. The matcher keeps running in parallel, so a notifier
doesn't replace module development.

`workflows-src/trello-notify.ts` (source) → `build-workflow` → artifact:

```ts
import { defineWorkflow, graph, node } from "@opencode-workflow/sdk";
import type { CommandResult, IWorkflowRuntime, IWorkflowTask } from "@opencode-workflow/sdk";

interface NotifyData { task: IWorkflowTask; send: CommandResult; }

export default defineWorkflow<NotifyData>({
  id: "trello-notify",
  label: "Trello → Telegram",
  phases: ["notify"],
  seed: (task) => ({ task, send: { ok: false, error: "not sent" } }),
  create: (rt) =>
    graph("notify", [
      node("notify", {
        run: async (ctx) => {
          const send = await rt.commands.execute({
            service: "telegram",
            op: "messages.send",
            params: { text: `Новая задача: ${ctx.data.task.title}` },
          });
          if (!send.ok) throw new Error(`telegram send failed: ${send.error}`);
          return ctx;
        },
      }),
    ]),
});
```

Platform support (already wired in `main.ts`):

- `TelegramConnector` — service `telegram`, op `messages.send`
  (`text`, optional `chat_id`), secrets `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`.
- `WorkflowTaskRouter` — subscribes `task.received` and starts every workflow
  id in `WORKFLOW_ON_TASK_RECEIVED`; logs and keeps going if an id isn't
  registered.