# Docker

The platform ships as a single image: **Bun + the opencode CLI +
the `.opencode` pack + the webhook endpoint**, built from the pnpm workspace
(the SDK package is linked in as a first-class workspace dependency).

## Image layout

Multi-stage build:

| Stage | Produces |
|---|---|
| `base` | bun runtime image (`oven/bun:1`) |
| `install` | production dependencies for `@opencode-workflow/platform` and its workspace deps (via `pnpm install --filter @opencode-workflow/platform... --prod`) |
| `opencode` | the opencode CLI (`bun install -g opencode-ai@1.18.30`) — needed for the self-started server |
| `release` | platform + SDK source, linked `node_modules`, `.opencode/` pack, the `opencode` binary |

The `release` stage runs as the unprivileged `bun` user, exposes `8787/tcp`,
and `WORKDIR` is `apps/platform` (where the workspace scripts live):

```
CMD ["bun", "run", "webhook"]
```

`pnpm-lock.yaml` is committed for reproducible installs
(`--frozen-lockfile`), and `.dockerignore` excludes `node_modules`, git
metadata, logs, secrets and build artifacts.

## Custom workflows volume

Custom workflows are **compiled outside the image** and mounted read-only (or
writable) into `WORKFLOWS_DIR` (`/app/workflows`). The webhook loads them at
start; the `watch-workflows` sidecar keeps them hot:

```bash
docker run -p 8787:8787 -d \
  -v /host/path/to/workflows:/app/workflows \
  opencode-workflow
```

To also run the sidecar inside the container, override the command:

```bash
docker run -p 8787:8787 -d \
  -v /host/path/to/workflows:/app/workflows \
  -e RELOAD_TOKEN="$(openssl rand -hex 16)" \
  opencode-workflow
  sh -c 'bun run webhook & bun run watch-workflows; wait'
```

## Build & run

```bash
docker build -t opencode-workflow .
docker run -p 8787:8787 -d opencode-workflow

curl http://127.0.0.1:8787/health      # { "ok": true }
curl http://127.0.0.1:8787/agents      # agents from the pack (build, unit-test, refactor, …)
curl http://127.0.0.1:8787/workflows   # module + any mounted workflow artifacts
```

The container starts its own opencode server on the first run, reads the pack
in `.opencode/`, and serves the full API (`/run`, `/task`, `/workflow/:id`,
`/hooks`, `/stream`, …).

## Secrets

Trello credentials and opencode server auth are passed only via env:

```bash
docker run -p 8787:8787 -d -e TRELLO_API_KEY=… -e TRELLO_TOKEN=… opencode-workflow
```

Nothing secret is baked into the image.

## Dev

For local development with hot code the workspace already links the SDK into
the platform, so:

```bash
bun run webhook      # platform on :8787 (reads WORKFLOWS_DIR)
bun run watch        # task-source poller (optional)
bun run web:dev      # dashboard, proxies under /workflow* and /stream
```

## Gotcha

The pack is copied as the `.opencode/` dot-directory; because a git submodule
lives there, the `**/.git` ignore rule is what keeps the pointer file *and*
dependencies out of the build context. The image contains only the pack's
files, not its git metadata.