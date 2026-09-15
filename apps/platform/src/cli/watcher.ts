import { InMemoryEventBus } from "../impl/InMemoryEventBus.ts";
import { TaskWatcher } from "../impl/TaskWatcher.ts";
import { FileTaskSource } from "../impl/FileTaskSource.ts";
import { TrelloTaskSource } from "../impl/TrelloTaskSource.ts";
import { CommandExecutor } from "../impl/CommandExecutor.ts";
import { TrelloConnector } from "../impl/TrelloConnector.ts";
import { TelegramConnector } from "../impl/TelegramConnector.ts";
import { OpencodeConnector } from "../impl/OpencodeConnector.ts";
import { GitHubConnector } from "../impl/GitHubConnector.ts";
import { OpencodeAgentExecutor } from "../impl/OpencodeAgentExecutor.ts";
import { FilePipelineStateStore } from "../impl/FilePipelineStateStore.ts";
import { ConfigWorkerRegistry } from "../impl/ConfigWorkerRegistry.ts";
import { GeneralModuleWorker } from "../impl/GeneralModuleWorker.ts";
import { NestJSModuleWorker } from "../impl/NestJSModuleWorker.ts";
import { DotNetModuleWorker } from "../impl/DotNetModuleWorker.ts";
import { ModulePipeline } from "../impl/ModulePipeline.ts";
import { ModuleMatcher } from "../impl/ModuleMatcher.ts";
import { WorkflowRegistry } from "../impl/WorkflowRegistry.ts";
import { WorkflowDirLoader } from "../impl/WorkflowDirLoader.ts";
import { WorkflowTaskRouter, parseWorkflowIds } from "../impl/WorkflowTaskRouter.ts";
import type { ITaskSource } from "@opencode-workflow/sdk";

/** CLI: поллинг источника задач → задача уходит в пайплайн (через матчер) и в workflow-реакторы. */
async function main(): Promise<void> {
  const bus = new InMemoryEventBus();
  const executor = await OpencodeAgentExecutor.create();
  const commands = new CommandExecutor([
    new OpencodeConnector(executor),
    new TrelloConnector(),
    new TelegramConnector(),
    new GitHubConnector(),
  ]);
  const registry = new ConfigWorkerRegistry([new GeneralModuleWorker(), new NestJSModuleWorker(), new DotNetModuleWorker()]);
  const store = new FilePipelineStateStore();
  const pipeline = new ModulePipeline(executor, store, bus, registry);
  const matcher = new ModuleMatcher(bus, pipeline);

  const workflows = new WorkflowRegistry();
  const workflowsDir = process.env.WORKFLOWS_DIR ?? "workflows";
  const loader = new WorkflowDirLoader(workflowsDir, workflows, { executor, commands, bus, store }, bus);
  await loader.sync();
  const router = new WorkflowTaskRouter(bus, workflows, parseWorkflowIds(process.env.WORKFLOW_ON_TASK_RECEIVED));

  const source = pickTaskSource(commands);
  const watcher = new TaskWatcher(source, bus);
  await watcher.start();
  console.log(`watching ${source.id} (poll ~${process.env.TASK_POLL_INTERVAL_MS ?? 30000}ms)`);

  const shutdown = async () => {
    await watcher.stop();
    matcher.close();
    router.close();
    await executor.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

function pickTaskSource(commands: CommandExecutor): ITaskSource {
  const kind = process.env.TASK_SOURCE ?? "file";
  if (kind === "trello") return TrelloTaskSource.fromEnv(commands);
  return FileTaskSource.fromEnv();
}

main().then(
  () => {},
  (err) => {
    console.error(err);
    process.exit(1);
  }
);