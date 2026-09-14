# opencode-workflow

Платформа-оркестратор модульной разработки на Bun + TypeScript 7, работающая
через `@opencode-ai/sdk`. Пак `.opencode/` (субмодуль) — портируемые «мозги»
(агенты/скиллы); этот репозиторий — TS7-платформа (интерфейсы, классы, webhook,
источники задач) и **pnpm-монорепо**.

## Структура

| Пакет | Что внутри |
|---|---|
| `packages/sdk/` | `@opencode-workflow/sdk` — протоколы, `IWorkflowDefinition`, DSL-граф (`node`/`graph`/`session`), `workflowFormat`/`sdkVersion` |
| `apps/platform/` | Платформа: `src/core/` (только `I*`-интерфейсы, без логики), `src/impl/` (реализации), `src/engine/` (граф-движок), `src/http/` (webhook), `src/cli/`, `docs/`, `workflows-src/`, `workflows/` |
| `apps/web/` | React-дашборд (Vite + shadcn): SSE `/stream` → граф пайплайна, хуки, запуск workflow, ось времён |

## Ключевые входы

- `src/impl/ModulePipeline.ts` — state machine модульной разработки: `add` →
  `spec → planning → tests → implementation → verification`; `update` → `tests →
  implementation → verification`; `delete` → `implementation → verification`;
  `decompose` → `spec → planning`. Retry-бюджет `PIPELINE_MAX_RETRIES`, отмена через
  `stop()`. Состояние — в `IPipelineStateStore`, события — в шину.
- `src/impl/ModuleMatcher.ts` — `task.received` → детекция `action`/`domain` →
  запуск pipeline (module-workflow).
- `src/core/workflows.ts` + `src/impl/WorkflowRegistry.ts` — реестр workflow
  (`module` + кастомные). `WorkflowDirLoader` грузит собранные артефакты из
  `WORKFLOWS_DIR`; `GraphWorkflow` исполняет их `IWorkflowDefinition` на
  `src/engine/` (NodeGraphBuilder + DepthFirstNodeRunner).

## Кастомные workflow

- `apps/platform/workflows-src/` — TS-исходники (`export default defineWorkflow(...)`).
- `apps/platform/workflows/` — **собранные** артефакты `<id>/{index.js, manifest.json}` (gitignored).
- Типы проверяются на сборке (`build-workflow`), в рантайме — только гейт
  контракта `format` + `sdkVersion` из `manifest.json` (несоответствие →
  `workflow.error`, платформа не падает).
- Hot-reload: `watch-workflows` (sidecar) поллит каталог → `POST /internal/workflows/reload` →
  `workflow.registered/updated/removed/error` → SSE/дашборд.

```bash
cd apps/platform
bun run build-workflow                 # workflows-src/*.ts → workflows/<id>/
bun run webhook & bun run watch-workflows &
curl -X POST http://127.0.0.1:8787/workflow/release-bump \
  -H 'content-type: application/json' -d '{"title":"Release 1.1.0"}'
```

Полный гайд: `apps/platform/docs/platform/workflows.md`, SDK-контракт —
`packages/sdk/src/workflow/definition.ts`, DSL — `packages/sdk/src/dsl/graph.ts`.

## HTTP API (webhook, :8787)

| Method | Path | Описание |
|---|---|---|
| `GET` | `/workflows` | список зарегистрированных workflow |
| `POST` | `/workflow/:id` | запуск workflow (`{title, meta?}` → `202 {runId}`) |
| `GET` | `/workflow/:id/:runId` | состояние рана |
| `POST` | `/workflow/:id/:runId/stop` | остановка → `cancelled` |
| `POST` | `/internal/workflows/reload` | реиндекс `WORKFLOWS_DIR` (loopback/token) |
| `GET/POST` | `/hooks`, `/hooks/:id` | вебхук-биндинги и ingress → workflow |
| `GET` | `/stream` | SSE `snapshot` + живые события |

OpenAPI: `apps/platform/docs/public/openapi.yaml`.

## Setup

```bash
git clone --recurse-submodules git@github.com:letnull19A/opencode-workflow.git
cd opencode-workflow
pnpm install        # corepack pnpm — фиксировано в packageManager + pnpm-lock.yaml
pnpm run typecheck  # pnpm -r typecheck
pnpm run test
```

## Run

```bash
pnpm run webhook             # платформа на :8787
pnpm run watch               # поллинг задач (TASK_SOURCE=file|trello)
pnpm run watch-workflows     # hot-reload каталога workflows
pnpm run start refactor      # one-off агентский прогон
pnpm run web:dev             # дашборд (vite, прокси /workflow*, /stream)
```

## Env

| Variable | Purpose |
|---|---|
| `OPENCODE_SERVER_URL` | attach к запущенному серверу; пусто → self-start |
| `OPENCODE_DIRECTORY` | каталог проекта в attach-режиме |
| `OPENCODE_SERVER_PASSWORD` / `OPENCODE_SERVER_USERNAME` | Basic Auth сервера |
| `PORT` | порт webhook (default `8787`) |
| `WORKFLOWS_DIR` | каталог собранных workflow (default `workflows`) |
| `WATCHER_POLL_MS` | интервал поллинга watch-workflows (default `2000`) |
| `RELOAD_TOKEN` | токен для `/internal/workflows/reload` (прод-режим) |
| `TASK_SOURCE` / `TASK_SOURCE_FILE` / `TASK_POLL_INTERVAL_MS` | источник задач |
| `STATE_DIR` | стейт (default `~/.local/state/opencode-workflow`) |
| `TRELLO_API_KEY`, `TRELLO_TOKEN`, `TRELLO_BOARD`, `TRELLO_INBOX_LIST`, `TRELLO_DONE_LIST` | Trello-источник |
| `PIPELINE_MAX_RETRIES` / `PHASE_TIMEOUT_MS` / `PHASE_SETTLE_MS` | бюджет и таймауты module-pipeline |
| `DELIVERY_ENABLED` / `DELIVERY_PUSH` / `PROJECT_DIR` | опциональный delivery (commit/push) |
| `EVENT_HISTORY_LIMIT` / `DELIVERY_DEDUP_LIMIT` | окна history и дедупа |

## Docker

Полное описание — `apps/platform/docs/reference/docker.md`. Образ на `oven/bun:1`,
зависимости ставятся pnpm (`--filter @opencode-workflow/platform... --prod`),
`WORKFLOWS_DIR` монтируется как volume:

```bash
docker build -t opencode-workflow .
docker run -p 8787:8787 -d -v /host/workflows:/app/workflows opencode-workflow
```

Секреты — только env, в образ ничего секретного не зашивается.