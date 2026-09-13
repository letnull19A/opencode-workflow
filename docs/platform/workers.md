# Workers

Workers are the *domain brains* of the pipeline. They own everything
domain-specific: the language of a phase prompt, the test runner hint, the
FAIL marker and the proxy agent selection.

## Contract

`src/core/worker.ts`:

```ts
interface IModuleWorker {
  readonly id: string;
  readonly domain: ModuleDomain;
  canHandle(action: ModuleAction): boolean;
  promptFor(action: ModuleAction, phase: PipelinePhase, task: IWorkflowTask): string;
  verify(text: string): boolean;
  agentFor(action: ModuleAction, phase: PipelinePhase): string | undefined;
}
```

## Base class

`BaseModuleWorker` implements the shared behaviour:

- `promptFor` — dispatches by action to `addPrompt` / `updatePrompt` /
  `deletePrompt` / `decomposePrompt`, which produce the per-phase prompts
  (spec, planning, tests, implementation, verification).
- `verify` — **passes unless the output contains the `FAIL` marker**.
- `agentFor` — the proxy-agent mapping:

| Action × Phase | Proxy agent |
|---|---|
| any × `tests` | `unit-test` |
| `update`/`delete`/`decompose` × `implementation` | `refactor` |
| everything else | `build` (default) |

- `testRunnerHint` — a short hint placed into tests-phase prompts.

## Domain workers

| Worker | Domain | Language | Test runner hint |
|---|---|---|---|
| `NestJSModuleWorker` | `nestjs` | TypeScript | jest in a NestJS app |
| `DotNetModuleWorker` | `dotnet` | C# | `dotnet test` in a .NET solution |
| `GeneralModuleWorker` | `general` | TypeScript | generic (fallback) |

All three are re-exported from `src/workers/index.ts`.

The proxy agents (`unit-test`, `refactor`) live in the `.opencode` pack — see
[The .opencode Pack](/reference/pack).

## Registry

`ConfigWorkerRegistry` implements `IWorkerRegistry`:

```ts
resolve(domain: ModuleAction, action: ModuleAction): IModuleWorker[] {
  // exact domain + canHandle wins
  // otherwise fall back to domain === "general"
}
```

Resolution is per *prompt*: the pipeline takes
`resolve(domain, action)[0]`. If no exact-domain worker handles the action, the
`general` worker is used — so an action not supported by the concrete domain
degrades gracefully instead of failing.

The default wiring registers `General + NestJS + DotNet`, as seen in
`src/http/main.ts` and `src/cli/watcher.ts`.

## Extending

To add a domain:

1. Subclass `BaseModuleWorker`, override the constructor config (id, domain,
   language, testRunner) and optionally `testRunnerHint`.
2. Register it in `ConfigWorkerRegistry` at every entry point that wires the
   platform (`main.ts`, `watcher.ts`, `cli/index.ts` module mode).
3. Optionally add domain keyword parsing in `ModuleMatcher.detectDomain`.