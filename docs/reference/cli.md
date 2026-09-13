# CLI Commands

All commands run through Bun (`bun run …`), except `start`, which maps to
`bun src/cli/index.ts`.

## One-off agent run

```bash
bun run start [agent]
```

Sends the workflow prompt to the given agent (default: `build`) against an
opencode server, prints the session id and the response, then exits.

```bash
bun run start refactor        # use the refactor agent
bun run start                 # default build agent
```

## Module run (by name)

```bash
bun run start module "<module title>" [--domain <d>] [--action <a>]
```

Starts the module pipeline directly for a module *named in the command*. Action
and domain are auto-detected from the title unless overridden:

```bash
bun run start module "User Profile"
bun run start module "User Profile" --domain nestjs --action add
```

Phase events print to stdout (`[phase] run-…: spec` …), progress persists to
the state store, and the final line is the terminal state:

```
[result] run-cli-user-profile: done
```

Run the pipeline against a different project by changing the working directory
(an opencode server is started there), or point to an existing server with
`OPENCODE_SERVER_URL`.

## Task watcher

```bash
bun run watch
```

Polls a task source (`TASK_SOURCE=file|trello`) and feeds tasks to the pipeline
through the matcher. See [Task Sources & Events](/platform/tasks).

## Webhook

```bash
bun run webhook         # :8787
PORT=9000 bun run webhook
```

Starts the HTTP API — see [HTTP API](/reference/api).

## Tooling

| Command | Purpose |
|---|---|
| `bun run typecheck` | `tsc --noEmit` (TypeScript 7, typecheck only) |
| `bun run docs:dev` | VitePress dev server |
| `bun run docs:build` | VitePress static build |
| `bun run docs:preview` | Preview the built docs site |