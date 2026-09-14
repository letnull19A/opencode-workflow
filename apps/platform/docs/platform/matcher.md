# Module Matcher

`ModuleMatcher` turns a raw task title into a pipeline start. It subscribes to
`task.received` and, if the title matches, resolves the strategy (action) and
domain, then calls `pipeline.start(task, domain, action)`.

## Action detection

Priority is **decompose → delete → update → add** (first match wins):

| Action | Trigger keywords |
|---|---|
| `decompose` | «декомпози/разб[ие]», split, decouple, разнеси/разнест, дроб |
| `delete` | удали/убери, remove, delete, почисти |
| `update` | обнови/измени/попра[вв], update, change, refactor, передела |
| `add` | создать/новый модуль, create, add, implement, разработ[ае], module, feature |

`detectAction(title)` returns the matched action without the matcher.

## Domain detection

`detectDomain(title)` scans keywords:

| Domain | Signals |
|---|---|
| `nestjs` | nestjs, nest |
| `dotnet` | .net, dotnet, c#, csharp |
| `frontend` | frontend/-front, react, vue, angular, ui, компонент |
| `general` | everything else |

## Gate

`defaultMatch(title)` is true when **any** of the four keyword groups matches,
so non-module tasks skip the pipeline entirely. A custom gate can be injected
through `ModuleMatcherConfig.match`.

## Wiring

The matcher is constructed with `(bus, pipeline)` and used by both the watcher
and the webhook entries. `close()` unsubscribes.

> The module CLI (`bun run start module "…"`) and `POST /module` bypass the
> matcher on purpose: they resolve action/domain directly (or take explicit
> `--action`/`--domain` / JSON fields).