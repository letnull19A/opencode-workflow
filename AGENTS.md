# AGENTS.md — opencode-workflow

Платформа-оркестратор модульной разработки. Пак `.opencode/` (субмодуль) —
портируемые «мозги» (агенты/скиллы), этот репозиторий — TS7-платформа
(интерфейсы, классы, webhook, источники задач).

## Code of Conduct

Полный кодекс — в `CODE_OF_CONDUCT.md` (нейминг интерфейсов `I...`,
запреты в именах классов, комментарии в коде — только JSDoc). Соблюдать обязательно.

## Command check

- `bun run typecheck` — `tsc --noEmit` (TypeScript 7, typecheck-only).
- `bun run start` — CLI: `bun src/cli/index.ts [agent]`.
- `bun run webhook` — webhook: `bun src/http/main.ts` (порт `PORT`, дефолт `8787`).
- `bun run watch` — poll task source (`TASK_SOURCE=file|trello`) → events → pipeline.

## Layout (ownership)

- `src/core/` — только интерфейсы (`I*`) и type-юнионы; логики нет.
- `src/impl/` — классы-реализации интерфейсов.
- `src/http/` — `HttpApiController` (Bun.serve) + `main.ts` (wire из env).
- `src/cli/` — точечные entry.

## Never do

- Коммиты/пуш — только через `/commit` и `/push` (пак `.opencode/`).
- Секреты (`TRELLO_*`, `CONTEXT7_API_KEY`, `DOKPLOY_*`) — только через
  `{env:...}` / env, в репозиторий не коммитить.
- Не проверяй типы за пределами `src/` (субмодуль `.opencode/` — не наш код).