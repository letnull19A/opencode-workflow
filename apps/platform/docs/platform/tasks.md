# Task Sources & Events

Tasks enter the platform through a source, are propagated over an event bus,
and are picked up by the matcher or the HTTP layer.

## Task model

`IWorkflowTask` is the normalised, source-agnostic task:

```ts
interface IWorkflowTask {
  externalId: string;
  source: string;         // "file" | "trello" | "cli" | …
  title: string;
  description?: string;
  url?: string;
  labels?: string[];
  attachments?: Array<{ name: string; url: string; kind?: "image"|"file"|"link" }>;
  createdAt: string;
  meta?: Readonly<Record<string, unknown>>;
}
```

## Sources

Contract (`src/core/task.ts`):

```ts
interface ITaskSource {
  readonly id: string;
  fetchNewTasks(limit?: number): Promise<IWorkflowTask[]>;
  ackTask(task: IWorkflowTask): Promise<void>;
}
```

### FileTaskSource

Reads a local JSON file (an array of `IWorkflowTask`) for offline demos.
`ackTask` is a no-op — the file is read-only.

- Env: `TASK_SOURCE_FILE` (default `tasks.json`).

### TrelloTaskSource

Talks to the Trello REST API only:

- **fetch** — open cards of the inbox list are mapped to `IWorkflowTask`
  (title, description, url, labels, attachments).
- **ack** — moves the card to the done list.

The board is selected by name (`TRELLO_BOARD`); without it the first open board
is used. List names are resolved from real board data — nothing is guessed.

- Env: `TRELLO_API_KEY`, `TRELLO_TOKEN` (required), `TRELLO_BOARD`,
  `TRELLO_INBOX_LIST` (default `Inbox`), `TRELLO_DONE_LIST` (default `Done`).

## TaskWatcher

`TaskWatcher` is the polling bridge: source → bus.

- Polls `fetchNewTasks` every `TASK_POLL_INTERVAL_MS` (default `30000`).
- Publishes `task.received` for every task whose `externalId` is not already in
  the processed set, then acks it and records it in processed state.
- Processed ids are persisted to `<STATE_DIR>/processed.json` — deduplication
  survives restarts.

## Events

See [Architecture → Events](/platform/architecture#events). The bus contract:

```ts
type WorkflowEvent =
  | { type: "task.received"; task: IWorkflowTask }
  | { type: "pipeline.phase"; runId: string; phase: PipelinePhase }
  | { type: "pipeline.done"; runId: string }
  | { type: "pipeline.failed"; runId: string; error: string };
```

`InMemoryEventBus.publish` calls listeners synchronously and isolates errors;
`subscribe` returns an unsubscribe function.