import { InMemoryEventBus } from "../impl/InMemoryEventBus.ts";
import { TaskWatcher } from "../impl/TaskWatcher.ts";
import { FileTaskSource } from "../impl/FileTaskSource.ts";
import { TrelloTaskSource } from "../impl/TrelloTaskSource.ts";
import { CommandExecutor } from "../impl/CommandExecutor.ts";
import { TrelloConnector } from "../impl/TrelloConnector.ts";
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
import type { ITaskSource } from "../core/task.ts";

/** CLI: поллинг источника задач → задача уходит в пайплайн (через матчер). */
async function main(): Promise<void> {
  const bus = new InMemoryEventBus();
  const executor = await OpencodeAgentExecutor.create();
  const commands = new CommandExecutor([
    new OpencodeConnector(executor),
    new TrelloConnector(),
    new GitHubConnector(),
  ]);
  const registry = new ConfigWorkerRegistry([new GeneralModuleWorker(), new NestJSModuleWorker(), new DotNetModuleWorker()]);
  const pipeline = new ModulePipeline(executor, new FilePipelineStateStore(), bus, registry);
  const matcher = new ModuleMatcher(bus, pipeline);

  const source = pickTaskSource(commands);
  const watcher = new TaskWatcher(source, bus);
  await watcher.start();
  console.log(`watching ${source.id} (poll ~${process.env.TASK_POLL_INTERVAL_MS ?? 30000}ms)`);

  const shutdown = async () => {
    await watcher.stop();
    matcher.close();
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