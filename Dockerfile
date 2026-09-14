# opencode-workflow — контейнеризация пакета-оркестратора.
# Итоговый образ: bun + opencode CLI + платформа (webhook + watcher + CLI)
# из pnpm-монорепо. Запуск по умолчанию — webhook на :8787; поверх
# поднимается opencode-сервер. Кастомные workflow загружаются из volume,
# смонтированного в /app/workflows (WORKFLOWS_DIR).

FROM oven/bun:1 AS base
WORKDIR /app

# ---------- production deps (pnpm workspace, только платформа) ----------
FROM node:22-alpine AS install
RUN corepack enable
WORKDIR /pkg
COPY pnpm-workspace.yaml package.json apps/platform/package.json apps/web/package.json packages/sdk/package.json ./
COPY pnpm-lock.yaml ./
RUN pnpm install --filter @opencode-workflow/platform... --prod --frozen-lockfile

# ---------- opencode CLI (self-start server) ----------
FROM base AS opencode
RUN bun install -g opencode-ai@1.18.30

# ---------- runtime ----------
FROM base AS release
ENV NODE_ENV=production
ENV HOME=/home/bun
ENV WORKFLOWS_DIR=/app/workflows

COPY --from=install /pkg/node_modules /app/node_modules
COPY --from=install /pkg/apps/platform/node_modules /app/apps/platform/node_modules
COPY --from=install /pkg/packages/sdk/node_modules /app/packages/sdk/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY apps/platform/ apps/platform/
COPY packages/sdk/ packages/sdk/
COPY .opencode/ .opencode/
COPY AGENTS.md CODE_OF_CONDUCT.md README.md ./

COPY --from=opencode /usr/local/bin/opencode /usr/local/bin/opencode

RUN mkdir -p /app/workflows && chown -R bun:bun /app

USER bun
EXPOSE 8787/tcp

# Фейковые креды создают вспомогательный предупреждающий вывод; реальные ключи
# передавать через env (TRELLO_API_KEY/TRELLO_TOKEN/OPENCODE_SERVER_*).
WORKDIR /app/apps/platform
CMD ["bun", "run", "webhook"]