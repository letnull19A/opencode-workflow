export type {
  INode,
  INodeContext,
  INodeExecutor,
  INodeSpec,
  INodeGraph,
  IEntrypointNode,
  INodeRunner,
  INodeRunnerOptions,
  IGraphBuilder,
  ICommandAwareNodeExecutor,
} from "./protocol/node.ts";

export type {
  ICommand,
  CommandResult,
  IServiceConnector,
  ICommandExecutor,
} from "./protocol/command.ts";

export type { IAgentExecutor, PromptSessionResult, SessionSummary } from "./protocol/executor.ts";

export type { ITaskAttachment, IWorkflowTask, ITaskSource } from "./protocol/task.ts";

export type {
  WebhookProvider,
  IWebhookBinding,
  IWebhookStore,
  WebhookFilterResult,
  IWebhookProvider,
  IWebhookContext,
  IWebhookEnvelope,
  IWorkflowStarter,
} from "./protocol/webhook.ts";

export type { IEventBus, IEventHistory } from "./protocol/events.ts";

export type { IVault } from "./protocol/vault.ts";

export type {
  IWorkflowDefinition,
  IWorkflowGraph,
  IWorkflowRuntime,
} from "./workflow/definition.ts";

export { defineWorkflow } from "./workflow/definition.ts";

export { node, graph, session } from "./dsl/graph.ts";
export type { INodeOptions } from "./dsl/graph.ts";

export {
  opencodeCreateSession,
  opencodeSessionPrompt,
  opencodeSessionHistory,
  opencodeWorktree,
  projectMap,
} from "./dsl/opencode.ts";
export type {
  SessionState,
  SessionData,
  ProjectData,
  SessionHistoryData,
  WorktreeData,
  OpencodeNodeOptions,
  CreateSessionOptions,
  SessionPromptOptions,
  ProjectMapOptions,
  SessionHistoryOptions,
  WorktreeOptions,
} from "./dsl/opencode.ts";

export {
  OpencodeError,
  OpencodeConnectionError,
  OpencodeSessionCreateError,
  OpencodeSessionPromptError,
  OpencodeWorktreeError,
} from "./errors.ts";

export { workflowFormat, sdkVersion } from "./version.ts";