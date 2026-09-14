import type { IWebhookBinding, IWebhookProvider, WebhookFilterResult } from "@opencode-workflow/sdk";
import type { IWorkflowTask } from "@opencode-workflow/sdk";

interface WorkflowRunEvent {
  action?: string;
  conclusion?: string | null;
  delivery_id?: string;
  workflow_run?: {
    id?: number;
    html_url?: string;
    name?: string;
    head_branch?: string | null;
    head_sha?: string;
    repository?: {
      full_name?: string;
    };
  };
  repository?: {
    full_name?: string;
  };
}

/**
 * Провайдер GitHub: workflow_run completed + failure → задача фикса.
 * Внешний id стабилен (github-run-<run_id>) — ределивери дедуплицируются.
 */
export class GitHubWebhookProvider implements IWebhookProvider {
  readonly name = "github" as const;

  toTask(binding: IWebhookBinding, payload: unknown, headers: Readonly<Record<string, string>>): WebhookFilterResult {
    const event = payload as WorkflowRunEvent | undefined;
    if (!event) return { accepted: false, reason: "no payload" };
    if (event.action !== "completed") {
      return { accepted: false, reason: `action "${event.action ?? "?"}" != completed` };
    }
    if (event.conclusion !== "failure") {
      return { accepted: false, reason: `conclusion "${event.conclusion ?? "?"}" != failure` };
    }
    const run = event.workflow_run;
    if (!run?.id) return { accepted: false, reason: "no workflow_run.id" };
    const repo = run.repository?.full_name ?? event.repository?.full_name ?? "";
    const title = `Fix failed CI: ${run.name ?? "workflow"} (${repo})`;
    const fallback = event.delivery_id ?? headers["x-github-delivery"] ?? `${Date.now()}`;
    const task: IWorkflowTask = {
      externalId: `github-run-${run.id}`,
      source: binding.source,
      title,
      url: run.html_url,
      labels: ["ci", "failed", run.name].filter((l): l is string => !!l),
      description: [
        `Workflow: ${run.name ?? "?"}`,
        `Repo: ${repo}`,
        `Branch: ${run.head_branch ?? "?"}`,
        `SHA: ${run.head_sha ?? "?"}`,
        `Conclusion: ${event.conclusion}`,
      ].join("\n"),
      createdAt: new Date().toISOString(),
      meta: {
        repo,
        branch: run.head_branch ?? "",
        sha: run.head_sha ?? "",
        runId: run.id,
        runUrl: run.html_url,
        conclusion: event.conclusion,
        deliveryId: fallback,
        attempt: 0,
        ...(binding.action ? { action: binding.action } : {}),
        ...(binding.domain ? { domain: binding.domain } : {}),
      },
    };
    return { accepted: true, task };
  }
}