import { HttpApiController } from "./HttpApiController.ts";
import { OpencodeAgentExecutor } from "../impl/OpencodeAgentExecutor.ts";
import { InMemoryEventBus } from "../impl/InMemoryEventBus.ts";
import { FilePipelineStateStore } from "../impl/FilePipelineStateStore.ts";
import { ConfigWorkerRegistry } from "../impl/ConfigWorkerRegistry.ts";
import { GeneralModuleWorker } from "../impl/GeneralModuleWorker.ts";
import { NestJSModuleWorker } from "../impl/NestJSModuleWorker.ts";
import { DotNetModuleWorker } from "../impl/DotNetModuleWorker.ts";
import { ModulePipeline } from "../impl/ModulePipeline.ts";
import { ModuleMatcher } from "../impl/ModuleMatcher.ts";

/** Wire из env и запуск HTTP-слоя платформы с пайплайном задач. */
async function main(): Promise<void> {
  const bus = new InMemoryEventBus();
  const unsubscribe = bus.subscribe((event) => {
    if (event.type === "task.received") {
      console.log(`[event] task.received: ${event.task.title}`);
    }
  });

  const executor = await OpencodeAgentExecutor.create();
  const store = new FilePipelineStateStore();
  const registry = new ConfigWorkerRegistry([new GeneralModuleWorker(), new NestJSModuleWorker(), new DotNetModuleWorker()]);
  const pipeline = new ModulePipeline(executor, store, bus, registry);
  const matcher = new ModuleMatcher(bus, pipeline);

  const controller = new HttpApiController(executor, bus, Number(process.env.PORT ?? 8787));
  controller.start();

  const shutdown = async () => {
    console.log("shutting down webhook...");
    controller.stop();
    matcher.close();
    await executor.close();
    unsubscribe();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().then(
  () => {},
  (err) => {
    console.error(err);
    process.exit(1);
  }
);