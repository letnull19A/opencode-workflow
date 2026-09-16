# AGENTS.md — opencode-workflow

Платформа-оркестратор модульной разработки. Пак `.opencode/` (субмодуль) —
портируемые «мозги» (агенты/скиллы), этот репозиторий — TS7-платформа
(интерфейсы, классы, webhook, источники задач) в виде pnpm-монорепо.

## Philosophy (UNIX)

- Делай одно и делай хорошо: платформа не поднимает чужие процессы сама
  (opencode server, ngrok) — нет соединения = типизированная ошибка
  выполнения, а не silent self-start. Сервер opencode для демо живёт как
  отдельный pm2-app (`opencode`), платформа цепляется к нему по
  `OPENCODE_SERVER_URL`.
- Падай локально, живи глобально: любая ошибка — явный вывод (лог/событие/
  ответ API), но процесс не должен умирать целиком. Стартуй деградированно
  (offline-заглушка бросает на использовании), роути отказ в `pipeline.failed`.
- Ошибки — иерархия классов с наследованием: базовый `*Error` на домен,
  свои подклассы на каждую ноду/операцию (диагностика + семантика в коде).
  Значений секретов в сообщениях нет — только scope/key/id.

## Code of Conduct

Полный кодекс — в `CODE_OF_CONDUCT.md` (нейминг интерфейсов `I...`,
запреты в именах классов, комментарии в коде — только JSDoc). Соблюдать обязательно.

## Command check

- `pnpm run typecheck` — `tsc --noEmit` по всем workspace-пакетам (TypeScript 7, typecheck-only).
- `pnpm run test` — юнит-тесты (`bun test`).
- `pnpm run start` — CLI: `bun src/cli/index.ts [agent]` (`apps/platform/`).
- `pnpm run webhook` — webhook: `bun src/http/main.ts` (порт `PORT`, дефолт `8787`).
- `pnpm run watch` — poll task source (`TASK_SOURCE=file|trello`) → events → pipeline.
- `pnpm run build-workflow` — собрать `workflows-src/*.ts` → `workflows/<id>/` (артефакты).
- `pnpm run watch-workflows` — sidecar hot-reload каталога `WORKFLOWS_DIR` → `/internal/workflows/reload`.
- `pnpm run docs:build` / `web:build` — документация и дашборд.
- SDK-типы не менять без `packages/sdk/` typecheck; типы workflow-исходников
  проверяются только на `build-workflow`.

## Layout (ownership)

- `packages/sdk/` — `I*`-протоколы, `IWorkflowDefinition`, DSL-граф (`node`/`graph`/`session`), `workflowFormat`/`sdkVersion`.
- `apps/platform/src/core/` — только интерфейсы (`I*`) и type-юнионы; логики нет.
- `apps/platform/src/impl/` — классы-реализации: `ModulePipeline`, `ModuleMatcher`,
  `WorkflowRegistry`, `ModuleWorkflow`, `GraphWorkflow`, `WorkflowDirLoader`.
- `apps/platform/src/engine/` — граф-движок (NodeGraphBuilder + DepthFirstNodeRunner).
- `apps/platform/src/http/` — `HttpApiController` (Bun.serve) + `main.ts` (wire из env).
- `apps/platform/src/cli/` — точечные entry (`index`, `watcher`, `build-workflow`, `watch-workflows`).
- `apps/platform/workflows-src/` — исходники кастомных workflow (типы — только на build).
- `apps/platform/workflows/` — собранные артефакты `<id>/{index.js, manifest.json}` (gitignored; mount в Docker).
- `apps/web/` — React-дашборд (Vite).

## Never do

- Коммиты/пуш — только через `/commit` и `/push` (пак `.opencode/`).
- Секреты (`TRELLO_*`, `CONTEXT7_API_KEY`, `DOKPLOY_*`) — только через
  `{env:...}` / env, в репозиторий не коммитить.
- Не проверяй типы за пределами workspace (`node_modules` и собранные `workflows/`
  — не наш код; `.opencode/` — субмодуль).
- `manifest.json` в `workflows/` не править руками — только `build-workflow`
  (формат/`sdkVersion` гейтится в рантайме, расхождение → `workflow.error`).
- Не поднимай opencode server / туннели из кода платформы или нод —
  только pm2/screen/systemd снаружи (см. Philosophy).