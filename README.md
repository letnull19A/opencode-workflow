# opencode-workflow

Демо работы с opencode через `@opencode-ai/sdk` на Bun: отправить промпт, дождаться ответа, завершить работу. Кастомные агенты берутся из `.opencode/` (сабмодуль).

## Состав

- `workflow.js` — общий модуль: подключение к opencode, авто-апрув permissions, прогон хардкод-промпта `"Test"`.
- `index.js` — CLI: `bun index.js [agent]`.
- `webhook.js` — HTTP: `GET /health`, `GET /agents`, `GET/POST /run(?agent=|{"agent":...})`.
- `.opencode/` — сабмодуль `letnull19A/.opencode` с агентами, командами и скиллами.

## Настройка

```bash
git clone --recurse-submodules git@github.com:letnull19A/opencode-workflow.git
cd opencode-workflow
pnpm install
```

Для существующего клона: `git submodule update --init`.

## Запуск

```bash
bun index.js refactor     # разовый прогон на агенте refactor (без аргумента — build)
bun webhook.js            # webhook на :8787
PORT=9000 bun webhook.js
```

## Env

| Переменная | Назначение |
|---|---|
| `OPENCODE_SERVER_URL` | attach к запущенному серверу (напр. `http://127.0.0.1:4096`); если нет или недоступен — поднимается свой |
| `OPENCODE_DIRECTORY` | проект для attach-режима (опционально) |
| `PORT` | порт webhook (по умолчанию `8787`) |

В attach-режиме действуют конфиг и модель запущенного сервера, а не локальные (`permission: allow`, `reasoningEffort: minimal` применяются только к собственному).
