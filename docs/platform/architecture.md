# Architecture

The platform is a set of **swappable nodes behind interfaces**, wired together
by thin entry points. Changing a dependency (Trello → a file, an in-memory
bus → Redis, the worker set) means replacing an implementation, not editing the
pipeline.

## Layers

| Directory | Responsibility |
|---|---|
| `src/core/` | Contracts only: `I*` interfaces and type unions, no logic |
| `src/impl/` | Concrete implementations of every contract |
| `src/http/` | `HttpApiController` (Bun.serve) + `main.ts` wire from env |
| `src/cli/` | Point entries: one-off agent run, module run, task watcher |
| `src/workers/` | Re-exports of the domain workers (`NestJSModuleWorker`, …) |
| `.opencode/` | Submodule pack: opencode agents, skills and slash-commands |

## Contracts (src/core)

| Contract | Purpose |
|---|---|
| `IAgentExecutor` | Run an agent session; list known agents |
| `ITaskSource` | Fetch new tasks, ack a processed task |
| `IWorkflowTask` | Normalised, source-agnostic task model |
| `IEventBus` | Publish/subscribe platform events |
| `IWorkerRegistry` | Map domain + action → candidate workers |
| `IModuleWorker` | Turn a task into phase prompts, verify results, pick proxy agents |
| `IPipelineStateStore` | Persist and load pipeline state |
| `IProjectDetector` | (contract) detect a consumer repo profile from manifests |

Logic lives only in `src/impl/`: `ModulePipeline`, `ModuleMatcher`,
`TaskWatcher`, domain workers, the executor and the task sources.

## Module layout

```
src/core/      executor.ts  events.ts  pipeline.ts  project.ts
               registry.ts  task.ts    types.ts     worker.ts
src/impl/      OpencodeAgentExecutor  ModulePipeline       ModuleMatcher
               BaseModuleWorker      NestJSModuleWorker    DotNetModuleWorker
               GeneralModuleWorker   ConfigWorkerRegistry  FilePipelineStateStore
               TaskWatcher           FileTaskSource        TrelloTaskSource
               InMemoryEventBus      slug
src/http/      HttpApiController     main.ts
src/cli/       index.ts              watcher.ts
src/workers/   index.ts
```

## Data flow

```
Task source ──► TaskWatcher ──► IEventBus ──► ModuleMatcher
                                               │  detectAction / detectDomain
                                               ▼
                                          ModulePipeline (state machine)
                                               │   prefers worker by registry
                                      ┌────────┴───────────────┐
                                      ▼                        ▼
                                 IModuleWorker           IWorkerRegistry
                                      │ promptFor / agentFor
                                      ▼
                                 IAgentExecutor ──► opencode server
                                      │                  (pack agents)
                                      ▼
                                 verify()  ◄── session text
                                      │
                                      ▼
                                 IPipelineStateStore (persist phase)
```

## Events

The event bus carries everything a consumer (logs, metrics, an SSE channel)
needs without knowing who published the event:

| Event | Payload |
|---|---|
| `task.received` | `task: IWorkflowTask` |
| `pipeline.phase` | `runId`, `phase` |
| `pipeline.done` | `runId` |
| `pipeline.failed` | `runId`, `error` |

`InMemoryEventBus` is the default implementation; it calls subscribers
synchronously in subscription order and isolates listener errors.

## Strategy, not monolith

Two design decisions keep the pipeline small and testable:

1. **Strategies are structured data.** `ACTION_PHASES` is a plain mapping
   `action → phase list`; the retry target is a separate `BACK_TO` map. Adding a
   new strategy is adding two table rows (see [Module Pipeline](/platform/pipeline)).
2. **Prompting is delegated.** The worker owns the *language* of a phase
   (prompt text, test runner hint, FAIL marker, proxy agent). The pipeline only
   walks phases and interprets pass/fail. Domain knowledge — jest vs `dotnet
   test` — lives in the workers, not in the state machine.