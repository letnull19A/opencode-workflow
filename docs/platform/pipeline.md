# Module Pipeline

`ModulePipeline` is the heart of the platform — a phase graph over the shared
node runner. Each phase is a node; `verification` branches through guard nodes
(`retry`/`fail`/`done`) that retry the `BACK_TO` phase against a budget. The
graph is built with `NodeGraphBuilder` and executed by `DepthFirstNodeRunner`
with a per-run context (`INodeContext<IPipelineData>`) and an `AbortController`
signal.

## Actions and their phase maps

`ACTION_PHASES` maps an action to the ordered list of phases:

| Action | Phases | When it fits |
|---|---|---|
| `add` | `spec → planning → tests → implementation → verification` | a brand-new module |
| `update` | `tests → implementation → verification` | change behaviour of an existing module |
| `delete` | `implementation → verification` | remove a module and its references |
| `decompose` | `spec → planning` | split a module; **no code**, design only |

The retry target on verification failure is `BACK_TO`:

| Action | Return to |
|---|---|
| `add` | `tests` |
| `update` | `tests` |
| `delete` | `implementation` |

## Phases

| Phase | What the worker asks the agent to do |
|---|---|
| `spec` | Purpose, boundaries, data, error cases |
| `planning` | Whether tests match the spec, implementation steps |
| `tests` | Write/update unit tests to match the spec |
| `implementation` | Implement per the spec; tests must pass |
| `verification` | Check tests match the spec and pass; answer `PASS` or `FAIL` |
| `done` | Terminal, success |
| `failed` | Terminal, budget exhausted or phase error |

## How a run works

```
start(task, domain, action)
  worker   = registry.resolve(domain, action)[0]  (general is the fallback)
  runId    = run-<source>-<externalId>
  graph    = graphFor(action, worker)             (cached per action+worker)
  ctx      = MapNodeContext<IPipelineData>(runId, stopper.signal, { task, action, domain, attempts: 0 })
  runner.run(graph.nodes[firstPhase], ctx)
```

- The graph is built once per `action+worker` (`NodeGraphBuilder` four passes:
  validate ids/outgoing/self-loops → instantiate → resolve outgoing → derive
  `incoming` mirrors) and cached; runs reuse it with per-run contexts.
- Every phase node builds a prompt (`worker.promptFor`) with the current task,
  selects the proxy agent (`worker.agentFor`), and runs a session via the
  executor. Phases persist their state and publish `pipeline.phase` *before*
  running the session (matching the linear semantics).
- `verification` is the only gate: `worker.verify(text)` **passes if the output
  does not contain the `FAIL` marker**. The `retry` guard increments
  `attempts` and re-enters the `BACK_TO` phase; `fail`/`done` guards have
  mutually exclusive conditions:

  - retry: `pass=false` and `attempts + 1 < PIPELINE_MAX_RETRIES`
  - fail:   `pass=false` and `attempts + 1 ≥ PIPELINE_MAX_RETRIES`
  - done:   `pass=true`

- An **error in a non-verification phase** throws and fails the run with the
  error captured, rather than silently skipping ahead. An error at the
  `verification` session counts as a failed verification (retry budget).
- `stop()` aborts the run's `AbortController` — the runner and in-flight
  session propagate it and the run finalises as `cancelled`.

## Events

`WorkflowEvent` published to the bus over a run's lifetime:

| Event | Payload | When |
|---|---|---|
| `pipeline.started` | `{ runId, task, action, domain }` | run begins |
| `pipeline.phase` | `{ runId, phase }` | each phase starts (non-terminal) |
| `pipeline.done` | `{ runId }` | verification passed (or last non-code phase finished) |
| `pipeline.failed` | `{ runId, error }` | budget exhausted or phase error |
| `pipeline.cancelled` | `{ runId }` | `stop()` aborted the run |
| `pipeline.delivered` | `{ runId, commit?, pushed }` | delivery committed the run |
| `pipeline.delivery_failed` | `{ runId, error }` | delivery aborted |

Terminal events never emit a `pipeline.phase`, so a terminal phase never
becomes the "current" phase in the graph view.

## State

`IPipelineState` is the persisted snapshot:

```ts
{
  runId: string;        // run-<source>-<externalId>
  phase: PipelinePhase;
  externalId: string;
  source: string;
  attempts: number;     // verification retries used
  action: ModuleAction;
  error?: string;
}
```

`FilePipelineStateStore` keeps one JSON file per run at
`<STATE_DIR>/<runId>.json` (`STATE_DIR` defaults to
`~/.local/state/opencode-workflow`), so long runs survive restarts and can be
inspected from the CLI or `GET /module/:runId`.

## Budget and timeouts

| Env | Default | Meaning |
|---|---|---|
| `PIPELINE_MAX_RETRIES` | `3` | verification-retry budget |
| `PHASE_TIMEOUT_MS` | `1200000` (20 min) | per-phase model budget; expiry fails the run |
| `PHASE_SETTLE_MS` | `60000` | silence window that ends a phase for providers missing step-finish events |

## Stopping a run

`POST /module/:runId/stop` aborts an active run through an `AbortController`
kept per `runId` in the pipeline. The in-flight agent session is interrupted
(the executor checks the signal before each request and inside the completion
poll), the run persists as `cancelled`, and the bus announces
`pipeline.cancelled`. Stopping an unknown run is `404`; stopping a run that is
known but not active is `409` with the current state. A cancelled run never
resumes — start a new one instead.

## Phase completion

The executor starts a phase asynchronously and **polls** the session instead of
waiting for a step-finish event. A phase is considered complete when either

- the latest assistant message carries the `completed` flag, or
- the output stayed identical for `PHASE_SETTLE_MS`.

This is what makes live runs terminate — see [Agent Executor](/platform/executor).