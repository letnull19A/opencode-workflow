# opencode-workflow — контейнеризация модульной платформы.
# Итоговый образ: bun + opencode CLI + платформа (HTTP webhook, watch, CLI).
# Запуск по умолчанию — webhook на :8787, поверх поднимается opencode-сервер.

FROM oven/bun:1 AS base
WORKDIR /app

# ---------- production deps ----------
FROM base AS install
RUN mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# ---------- opencode CLI (self-start server) ----------
FROM base AS opencode
RUN bun install -g opencode-ai@1.18.30

# ---------- runtime ----------
FROM base AS release
ENV NODE_ENV=production
ENV HOME=/home/bun

COPY --from=install /temp/prod/node_modules node_modules
COPY package.json bun.lock tsconfig.json ./
COPY src/ src/
COPY AGENTS.md CODE_OF_CONDUCT.md README.md ./
COPY .opencode/ .opencode/

COPY --from=opencode /usr/local/bin/opencode /usr/local/bin/opencode

RUN mkdir -p /app/.opencode && chown -R bun:bun /app

USER bun
EXPOSE 8787/tcp

# Фейковые креды создают вспомогательный предупреждающий вывод; реальные ключи
# передавать через env (TRELLO_API_KEY/TRELLO_TOKEN/OPENCODE_SERVER_*).
CMD ["bun", "run", "webhook"]