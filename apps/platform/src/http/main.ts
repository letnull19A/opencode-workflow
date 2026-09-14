import { HttpApiController } from "./HttpApiController.ts";
import { OpencodeAgentExecutor } from "../impl/OpencodeAgentExecutor.ts";
import { InMemoryEventBus } from "../impl/InMemoryEventBus.ts";
import { FilePipelineStateStore } from "../impl/FilePipelineStateStore.ts";
import { FileWebhookStore } from "../impl/FileWebhookStore.ts";
import { ConfigWorkerRegistry } from "../impl/ConfigWorkerRegistry.ts";
import { GeneralModuleWorker } from "../impl/GeneralModuleWorker.ts";
import { NestJSModuleWorker } from "../impl/NestJSModuleWorker.ts";
import { DotNetModuleWorker } from "../impl/DotNetModuleWorker.ts";
import { ModulePipeline } from "../impl/ModulePipeline.ts";
import { ModuleMatcher } from "../impl/ModuleMatcher.ts";
import { ModuleWorkflow } from "../impl/ModuleWorkflow.ts";
import { WorkflowRegistry } from "../impl/WorkflowRegistry.ts";
import { WorkflowDirLoader } from "../impl/WorkflowDirLoader.ts";
import { CommandExecutor } from "../impl/CommandExecutor.ts";
import { OpencodeConnector } from "../impl/OpencodeConnector.ts";
import { TrelloConnector } from "../impl/TrelloConnector.ts";
import { GitHubConnector } from "../impl/GitHubConnector.ts";
import { GitHubWebhookProvider } from "../impl/providers/GitHubWebhookProvider.ts";
import { GenericWebhookProvider } from "../impl/providers/GenericWebhookProvider.ts";
import { ScriptDelivery } from "../impl/ScriptDelivery.ts";
import type { IEventBus } from "../core/events.ts";
import type { IWorkflowTask } from "@opencode-workflow/sdk";
import type { IWebhookProvider } from "@opencode-workflow/sdk";

/** Wire из env и запуск HTTP-слоя платформы с workflow-реестром и вебхуками. */
async function main(): Promise<void> {
  const bus = new InMemoryEventBus();
  const offLog = bus.subscribe((event) => {
    if (event.type === "task.received") {
      console.log(`[event] task.received: ${event.task.title}`);
    }
  });

  const executor = await OpencodeAgentExecutor.create();
  const store = new FilePipelineStateStore();
  const registry = new ConfigWorkerRegistry([new GeneralModuleWorker(), new NestJSModuleWorker(), new DotNetModuleWorker()]);
  const pipeline = new ModulePipeline(executor, store, bus, registry);
  const matcher = new ModuleMatcher(bus, pipeline);

  const webhooks = {
    store: new FileWebhookStore(),
    providers: new Map<string, IWebhookProvider>([
      ["github", new GitHubWebhookProvider()],
      ["generic", new GenericWebhookProvider()],
    ]),
  };

  const commands = new CommandExecutor([
    new OpencodeConnector(executor),
    new TrelloConnector(),
    new GitHubConnector(),
  ]);

  const workflows = new WorkflowRegistry();
  workflows.register(new ModuleWorkflow(pipeline));

  const workflowsDir = process.env.WORKFLOWS_DIR ?? "workflows";
  const loader = new WorkflowDirLoader(workflowsDir, workflows, { executor, commands, bus, store }, bus);
  await loader.sync();

  const delivery = process.env.DELIVERY_ENABLED === "1" ? new ScriptDelivery(cwd()) : undefined;
  const offDelivery = subscribeDelivery(bus, delivery);

  const controller = new HttpApiController(
    executor,
    bus,
    Number(process.env.PORT ?? 8787),
    store,
    webhooks,
    workflows,
    loader
  );
  controller.start();
  logProviders(webhooks.providers);

  const shutdown = async () => {
    console.log("shutting down webhook...");
    controller.stop();
    matcher.close();
    offLog();
    offDelivery();
    await executor.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

function cwd(): string {
  return process.env.PROJECT_DIR ?? process.cwd();
}

function subscribeDelivery(bus: IEventBus, delivery?: ScriptDelivery): () => void {
  if (!delivery) return () => {};
  const runTasks = new Map<string, IWorkflowTask>();
  const trackLaunch = bus.subscribe((event) => {
    if (event.type === "pipeline.started") {
      runTasks.set(event.runId, event.task);
    }
  });
  const off = bus.subscribe((event) => {
    if (event.type !== "pipeline.done") return;
    const task = runTasks.get(event.runId) ?? { externalId: event.runId, source: "pipeline", title: event.runId, createdAt: new Date().toISOString() };
    void delivery
      .deliver({ runId: event.runId, task, directory: cwd() })
      .then((result) => {
        if (result.committed) {
          bus.publish({ type: "pipeline.delivered", runId: result.runId, commit: result.commit, pushed: result.pushed });
          console.log(`[delivery] ${result.runId} committed=${result.committed} pushed=${result.pushed}`);
        } else if (result.error) {
          bus.publish({ type: "pipeline.delivery_failed", runId: result.runId, error: result.error });
          console.error(`[delivery] ${result.runId}: ${result.error}`);
        }
      })
      .catch((err) => console.error(`[delivery] ${String(err)}`));
  });
  return () => {
    trackLaunch();
    off();
  };
}

function logProviders(providers: Map<string, unknown>): void {
  console.log(`[webhooks] providers: ${[...providers.keys()].join(", ")}`);
}

main().then(
  () => {},
  (err) => {
    console.error(err);
    process.exit(1);
  }
);