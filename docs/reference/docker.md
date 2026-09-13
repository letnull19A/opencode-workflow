# Docker

The whole platform ships as a single image: **Bun + the opencode CLI +
the `.opencode` pack + the webhook endpoint**.

## Image layout

Multi-stage build on `oven/bun:1`:

| Stage | Produces |
|---|---|
| `base` | bun runtime image |
| `install` | production dependencies only (`bun install --frozen-lockfile --production`) |
| `opencode` | the opencode CLI (`bun install -g opencode-ai@1.18.30`) — needed for the self-started server |
| `release` | platform code + `node_modules` + `.opencode/` pack + the `opencode` binary |

The `release` stage runs as the unprivileged `bun` user and exposes
`8787/tcp`; the default command is the webhook:

```
CMD ["bun", "run", "webhook"]
```

`bun.lock` is committed for reproducible installs (`--frozen-lockfile`), and
the `.dockerignore` excludes `node_modules`, git metadata, logs, secrets and
build files.

## Build & run

```bash
docker build -t opencode-workflow .
docker run -p 8787:8787 -d opencode-workflow

curl http://127.0.0.1:8787/health      # { "ok": true }
curl http://127.0.0.1:8787/agents      # agents from the pack (build, unit-test, refactor, …)
```

The container starts its own opencode server on the first run, reads the pack
in `.opencode/`, and serves the full API (`/run`, `/task`, `/module`, …).

## Secrets

Trello credentials and opencode server auth are passed only via env:

```bash
docker run -p 8787:8787 -d -e TRELLO_API_KEY=… -e TRELLO_TOKEN=… opencode-workflow
```

Nothing secret is baked into the image.

## Gotcha

The pack is copied as the `.opencode/` dot-directory; because a git submodule
lives there, the `**/.git` ignore rule is what keeps the pointer file *and*
dependencies out of the build context. The image contains only the pack's
files, not its git metadata.