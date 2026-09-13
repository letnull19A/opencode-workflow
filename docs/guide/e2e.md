# End-to-End (E2E)

A smoke E2E exercises the pipeline against a **real** opencode server from an
isolated sandbox directory, with the `.opencode` pack made available to the
server so the proxy agents (`unit-test`, `refactor`) resolve.

## Sandbox setup

```bash
# a consumer-like NestJS project with jest, ts-jest and node_modules installed
mkdir -p /tmp/nest-sandbox/src && cd /tmp/nest-sandbox
npm init -y

# make the pack (agents, skills, config) visible to the self-started server
ln -sfn /media/…/opencode-workflow/.opencode /tmp/nest-sandbox/.opencode
```

## Running the pipeline live

From the sandbox directory, run the platform CLI against the sandbox project
(the server inherits the working directory):

```bash
# fast proof: decompose reaches done after spec → planning
PHASE_SETTLE_MS=20000 bun /media/…/opencode-workflow/src/cli/index.ts \
  module "split auth into guards and sessions" --domain nestjs --action decompose

# full cycle: add runs all five phases
PHASE_SETTLE_MS=20000 PIPELINE_MAX_RETRIES=2 bun /media/…/opencode-workflow/src/cli/index.ts \
  module "password reset module" --domain nestjs --action add
```

Expected flow for `add`:

```
spec → planning → tests → implementation → verification → done
```

(`failed` if the verification never passes within `PIPELINE_MAX_RETRIES`.)
Intermediates are persisted to the pipeline state store, so you can follow the
run by watching `<STATE_DIR>/run-cli-*.json`.

## Verified behaviour

Live runs reached `done` on both:

- **`add`** — the full five-phase cycle (`spec → planning → tests → implementation → verification`);
- **`decompose`** — the two-phase cycle (`spec → planning`).

Phase completion is detected by polling the session: a message with the
`completed` flag ends the phase immediately; otherwise the phase ends once the
output stays stable for `PHASE_SETTLE_MS`. This makes runs finish even when the
provider never emits a dedicated step-finish event. Per-phase budget is
`PHASE_TIMEOUT_MS` (default 20 minutes); on expiry the run fails cleanly instead
of hanging.

> Note: in live runs the model may answer phases textually without writing files
> to the sandbox. That is model behaviour, not an orchestration defect — phase
> sequencing, state persistence and the retry loop are fully exercised.

## See also

- [Module Pipeline](/platform/pipeline) — the state machine behind the run.
- [Agent Executor](/platform/executor) — completion detection and timeouts.