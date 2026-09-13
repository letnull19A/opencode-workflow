# Web Dashboard

A Vite dashboard that visualises the module pipeline as a live graph and
streams run statuses over SSE. It lives in `web/` and talks to the webhook API
(in dev through Vite's server proxy).

## Stack

- React 19 + **React Compiler** (Rust, via `oxc-transform-react` in
  `@vitejs/plugin-react` with `compiler: true`)
- Vite 8 + TypeScript 7 (typecheck-only `tsc --noEmit`)
- Tailwind CSS v4 + **shadcn/ui** (Radix base, `Nova` preset)
- **React Flow** (`@xyflow/react`) for the pipeline graph
- Bun for everything (`bun install`, `bun run dev`, `bun run build`)

## Layout

| Area | Content |
|---|---|
| Header | app title, SSE connection badge, run counter, OpenAPI link |
| Left sidebar | **Start a module run** form (title + auto/explicit action & domain) and the list of observed runs |
| Main canvas | React Flow graph of the selected run: task node → phases → terminal (done/failed) |
| Right panel | Live event log (timestamped, severity-coloured) |

## Live model

`src/lib/workflow.ts` keeps a reducer `useWorkflow()`:

1. Opens `EventSource("/stream")` — Vite proxies `/stream` to the webhook.
2. On connect a `snapshot` frame **rebuilds** the run state (replay), then live
   frames apply as deltas (`pipeline.phase` → phase status, `pipeline.done`
   /`pipeline.failed` → terminal; `task.received` → run titles from external
   tasks).
3. `registerAndStart` calls `POST /module` and optimistically registers the run
   so the graph renders immediately, before the first phase event arrives.

Phase statuses: `pending` (muted), `running` (blue, pulsing), `done` (green),
`error` (red). The edge into the current phase is animated; a failed run turns
the terminal node red with the error message.

## Stopping a run

Any `running` run can be stopped: the square button in the run row (sidebar)
and the **Stop** button in the selected-run bar above the canvas both call
`POST /module/:runId/stop`. The backend aborts the in-flight agent session,
persists the run as `cancelled`, and announces `pipeline.cancelled`. The graph
turns the terminal node amber, reverts the interrupted phase to `pending`, and
the run badge switches to `cancelled`.

## Commands

```bash
cd web
bun install
bun run dev        # Vite dev server on http://localhost:5173 (proxy → :8787)
bun run build      # tsc --noEmit && vite build
bun run preview    # serve the built app
```

## Production

In production, serve the built app + webhook behind one origin so the SSE path
stays same-origin (a reverse proxy forwarding `/stream`, `/module`, `/health`,
… to the webhook on `:8787`). The OpenAPI file is served from the docs site at
`/openapi.yaml`.