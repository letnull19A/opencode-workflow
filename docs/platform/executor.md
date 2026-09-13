# Agent Executor

`OpencodeAgentExecutor` is the bridge between the platform and opencode. It
implements `IAgentExecutor` and sits behind the SDK `@opencode-ai/sdk`.

## Connectivity: attach or self-start

On `create()`:

1. If `OPENCODE_SERVER_URL` is set, it attaches to that server and **probes** it
   with `app.agents()`. If the probe fails, it logs a warning and falls through
   to self-start.
2. Otherwise it starts its own server (`createOpencodeServer`, port `0`) with a
   self-start config:
   - `permission: { edit, bash, webfetch, doom_loop, external_directory: allow }`;
   - provider options with `reasoningEffort: minimal`.

Tuning:

| Env | Effect |
|---|---|
| `OPENCODE_SERVER_URL` | attach mode; empty/unreachable → self-start |
| `OPENCODE_DIRECTORY` | project directory for attach mode |
| `OPENCODE_SERVER_PASSWORD` | Basic Auth password for a protected server |
| `OPENCODE_SERVER_USERNAME` | Basic Auth username (default `opencode`) |

In attach mode the running server's config and model are used, not the local
ones.

## Permission auto-approval

A background task subscribes to the server's global event stream. On
`permission.updated` it answers `always` for the affected session and
permission. This keeps unattended runs moving without prompts.

## Running a session

`runSession({ prompt, agent?, sessionTitle? })`:

1. Creates a session (title = `"<task> — <phase>"`).
2. Posts the prompt asynchronously (`/session/{id}/prompt_async`) with the
   chosen agent.
3. Awaits completion by **polling** `GET /session/{id}/message`.

### Completion detection

Instead of waiting for a dedicated step-finish event, the executor scans the
session messages and considers the turn complete when:

- the latest assistant message has the `completed` flag **or**
- the collected text is unchanged for `PHASE_SETTLE_MS`.

Polling is what makes runs terminate even for providers that never emit a
step-finish / `completed` — the original live runs stalled forever waiting on
the blocking prompt call. A per-phase budget `PHASE_TIMEOUT_MS` (default
20 minutes) bounds the wait; expiry throws, and the pipeline converts the error
into a clean `failed` state.

## Interface

```ts
interface IAgentExecutor {
  listAgents(): Promise<string[]>;
  runSession(opts: { prompt, agent?, sessionTitle? }): Promise<PromptSessionResult>;
}
```

`PromptSessionResult` is `{ sessionId, text }` — deliberately detached from the
SDK types so the pipeline only ever deals with the returned text.