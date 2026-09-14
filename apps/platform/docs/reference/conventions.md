# Conventions

Agents and contributors follow two documents: `AGENTS.md` (repo rules) and
`CODE_OF_CONDUCT.md` (binding style rules; it wins on conflict).

## Naming (`CODE_OF_CONDUCT.md`)

- Every **interface** starts with `I` — `ITaskSource`, `IWorkflowTask`,
  `IAgentExecutor`, …
- **Class names** must not contain `System`, `Manager`, `Controller`. The only
  exception is the HTTP/API layer, where `Controller` is allowed
  (`HttpApiController`).
- Type aliases/unions are **not** interfaces and get no `I` — `ModuleDomain`,
  `ModuleAction`, `PipelinePhase`, `WorkflowEvent`.

## Comments

- Comments in code are forbidden; the only allowed form is **JSDoc**
  (`/** … */`) on exported interfaces, classes and their public methods.
- No `//` line comments. Express a decision in the method/variable name or in
  JSDoc at the contract level.
- JSDoc belongs where the contract is not obvious from the signature: edge
  cases, interface guarantees, invariants. Obvious getters are not documented.

## Secrets

- Secrets and API keys only through `{env:…}` / environment variables.
- Never committed to the repository — ever.

## Git flow

- Commits and pushes happen only through `/commit` and `/push` (the
  `.opencode/` pack):
  - `/commit` — atomic Conventional Commits, grouped by intent, plan +
    explicit "yes", never `--force`, no secrets;
  - `/push` — `bash .opencode/scripts/push/run.sh`, pushes committed commits
    only; uncommitted files always stay local.
- The `.opencode/` submodule is upgraded the same way and the parent pointer is
  bumped in a `chore` commit.

## Typechecking

- `bun run typecheck` runs `tsc --noEmit`. The `src/` tree is TypeScript 7
  typecheck-only.
- Typecheck **only within `src/`** — the `.opencode/` submodule is not our code
  and is not checked from this repository.

## Platform ownership

| Area | Rule |
|---|---|
| `src/core/` | interfaces (`I*`) and type unions only — no logic |
| `src/impl/` | concrete implementations |
| `src/http/` | `HttpApiController` + `main.ts` wire from env |
| `src/cli/` | point entries |