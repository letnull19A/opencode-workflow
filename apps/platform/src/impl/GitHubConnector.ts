import type { CommandResult, ICommand, IServiceConnector } from "@opencode-workflow/sdk";

const GITHUB_API = "https://api.github.com";

function githubToken(): string {
  const t = process.env.GITHUB_TOKEN ?? "";
  if (!t) throw new Error("GITHUB_TOKEN должен быть в env");
  return t;
}

/**
 * Коннектор GitHub: логи упавших workflow-ранов, создание issue и PR.
 * Секреты — только из env (GITHUB_TOKEN).
 */
export class GitHubConnector implements IServiceConnector {
  readonly service = "github";

  canHandle(service: string): boolean {
    return service === this.service;
  }

  async execute(command: ICommand, signal?: AbortSignal): Promise<CommandResult> {
    try {
      switch (command.op) {
        case "workflow_runs.list":
          return this.ok(await this.get(`/repos/${command.params.repo}/actions/runs`, { per_page: "10" }, signal));
        case "jobs.list":
          return this.ok(await this.get(`/repos/${command.params.repo}/actions/runs/${command.params.runId}/jobs`, {}, signal));
        case "issues.create":
          return this.ok(await this.post(`/repos/${command.params.repo}/issues`, command.params, signal));
        case "pulls.create":
          return this.ok(
            await this.post(`/repos/${command.params.repo}/pulls`, pullRequestBody(command.params), signal)
          );
        default:
          return { ok: false, error: `unknown op "${command.op}"` };
      }
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  private async get<T>(path: string, query: Record<string, string>, signal?: AbortSignal): Promise<T> {
    const qs = new URLSearchParams(query).toString();
    const res = await fetch(`${GITHUB_API}${path}${qs ? `?${qs}` : ""}`, { headers: this.headers(), signal });
    if (!res.ok) throw new Error(`GitHub GET ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  private async post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const res = await fetch(`${GITHUB_API}${path}`, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new Error(`GitHub POST ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${githubToken()}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "opencode-workflow",
    };
  }

  private ok(data: unknown): CommandResult {
    return { ok: true, data };
  }
}

export interface PullRequestParams {
  title: string;
  head: string;
  base: string;
  body?: string;
  draft?: boolean;
}

export function pullRequestBody(params: Readonly<Record<string, unknown>>): PullRequestParams {
  const title = params.title;
  const head = params.head;
  const base = params.base;
  if (typeof title !== "string" || !title) throw new Error('pulls.create: params.title обязателен');
  if (typeof head !== "string" || !head) throw new Error('pulls.create: params.head обязателен');
  if (typeof base !== "string" || !base) throw new Error('pulls.create: params.base обязателен');
  const out: PullRequestParams = { title, head, base };
  if (typeof params.body === "string") out.body = params.body;
  if (typeof params.draft === "boolean") out.draft = params.draft;
  return out;
}