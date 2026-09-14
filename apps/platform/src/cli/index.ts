import { OpencodeAgentExecutor, WORKFLOW_PROMPT } from "../impl/OpencodeAgentExecutor.ts";
import { InMemoryEventBus } from "../impl/InMemoryEventBus.ts";
import { FilePipelineStateStore } from "../impl/FilePipelineStateStore.ts";
import { ConfigWorkerRegistry } from "../impl/ConfigWorkerRegistry.ts";
import { GeneralModuleWorker } from "../impl/GeneralModuleWorker.ts";
import { NestJSModuleWorker } from "../impl/NestJSModuleWorker.ts";
import { DotNetModuleWorker } from "../impl/DotNetModuleWorker.ts";
import { ModulePipeline } from "../impl/ModulePipeline.ts";
import { detectAction, detectDomain } from "../impl/ModuleMatcher.ts";
import { slugify } from "../impl/slug.ts";
import type { ModuleAction, ModuleDomain } from "../core/types.ts";
import type { IWorkflowTask } from "@opencode-workflow/sdk";

/** CLI: прогон одного агента или пайплайна модуля по имени (без matcher). */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "module") return runModule(args.slice(1));

  const agent = args[0];
  const executor = await OpencodeAgentExecutor.create();
  try {
    console.log(`> ${WORKFLOW_PROMPT}${agent ? ` [agent: ${agent}]` : ""}`);
    const { sessionId, text } = await executor.runSession({
      prompt: WORKFLOW_PROMPT,
      ...(agent ? { agent } : {}),
    });
    console.log(`Session: ${sessionId} (agent: ${agent ?? "build"})`);
    console.log(`< ${text}`);
  } finally {
    await executor.close();
  }
}

async function runModule(args: string[]): Promise<void> {
  const titleArgs = args.slice(0, args.findIndex((arg) => arg.startsWith("--")));
  const title = (titleArgs.length > 0 ? titleArgs : args).join(" ").trim();
  if (!title) throw new Error('module требует описание: bun run start module "<имя модуля>"');
  const domain = flagValue(args, "domain") as ModuleDomain | undefined;
  const action = flagValue(args, "action") as ModuleAction | undefined;

  const executor = await OpencodeAgentExecutor.create();
  const bus = new InMemoryEventBus();
  const unsubscribe = bus.subscribe((event) => {
    if (event.type === "pipeline.phase") console.log(`[phase] ${event.runId}: ${event.phase}`);
    if (event.type === "pipeline.done") console.log(`[done] ${event.runId}`);
    if (event.type === "pipeline.failed") console.log(`[failed] ${event.runId}: ${event.error}`);
  });
  try {
    const store = new FilePipelineStateStore();
    const registry = new ConfigWorkerRegistry([
      new GeneralModuleWorker(),
      new NestJSModuleWorker(),
      new DotNetModuleWorker(),
    ]);
    const pipeline = new ModulePipeline(executor, store, bus, registry);
    const task: IWorkflowTask = {
      externalId: slugify(title),
      source: "cli",
      title,
      createdAt: new Date().toISOString(),
    };
    const taskDomain = domain ?? detectDomain(title);
    const taskAction = action ?? detectAction(title);
    console.log(`[module] "${title}" -> domain: ${taskDomain}, action: ${taskAction} (run-${task.source}-${task.externalId})`);
    const state = await pipeline.start(task, taskDomain, taskAction);
    console.log(`[result] ${state.runId}: ${state.phase}${state.error ? ` — ${state.error}` : ""}`);
  } finally {
    unsubscribe();
    await executor.close();
  }
}

function flagValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);