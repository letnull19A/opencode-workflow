# Module Pipeline

`ModulePipeline` is the heart of the platform — a small state machine that
develops a module through a sequence of phases, retrying verification against a
budget.

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
  phases   = ACTION_PHASES[action]
  worker   = registry.resolve(domain, action)[0]  (general is the fallback)
  runId    = run-<source>-<externalId>
```

- For every phase the worker builds a prompt, `agentFor` selects the proxy
  agent and the executor runs a session.
- `verification` is the only gate: `worker.verify(text)` **passes if the output
  does not contain the `FAIL` marker**. On fail the pipeline returns to the
  `BACK_TO` phase, increments `attempts` and retries.
- Exhausting `PIPELINE_MAX_RETRIES` (default `3`) → `failed`.
- An **error in any phase** (for example a per-phase timeout) fails the run with
  the error captured, rather than silently skipping ahead.
- Every transition is persisted via `IPipelineStateStore` and published on the
  bus (`pipeline.phase`, `pipeline.done`, `pipeline.failed`).

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