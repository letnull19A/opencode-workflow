# opencode-workflow

Demo of working with opencode through `@opencode-ai/sdk` on Bun: send a prompt, wait for the answer, exit. Custom agents come from `.opencode/` (a submodule).

## Files

- `workflow.js` — shared module: connection to opencode, auto-approval of permissions, run of the hardcoded `"Test"` prompt.
- `index.js` — CLI: `bun index.js [agent]`.
- `webhook.js` — HTTP: `GET /health`, `GET /agents`, `GET/POST /run(?agent=|{"agent":...})`.
- `.opencode/` — submodule `letnull19A/.opencode` with agents, commands and skills.

## Setup

```bash
git clone --recurse-submodules git@github.com:letnull19A/opencode-workflow.git
cd opencode-workflow
pnpm install
```

For an existing clone: `git submodule update --init`.

## Run

```bash
bun index.js refactor     # single run with the refactor agent (default is build)
bun webhook.js            # webhook on :8787
PORT=9000 bun webhook.js
```

## Env

| Variable | Purpose |
|---|---|
| `OPENCODE_SERVER_URL` | attach to a running server (e.g. `http://127.0.0.1:4096`); if empty or unreachable, a new server is started |
| `OPENCODE_DIRECTORY` | project for attach mode (optional) |
| `OPENCODE_SERVER_PASSWORD` | password for a protected server (HTTP Basic Auth) |
| `OPENCODE_SERVER_USERNAME` | auth username (default `opencode`) |
| `PORT` | webhook port (default `8787`) |

In attach mode the running server's config and model are used, not the local ones (`permission: allow` and `reasoningEffort: minimal` apply only to a self-started server).
