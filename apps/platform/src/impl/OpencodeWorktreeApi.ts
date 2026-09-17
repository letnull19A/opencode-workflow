import { createOpencodeClient as createOpencodeClientV2 } from "@opencode-ai/sdk/v2";
import type { OpencodeClient as OpencodeClientV2 } from "@opencode-ai/sdk/v2";
import { serverAuthHeaders } from "./OpencodeAgentExecutor.ts";

/** Worktree на сервере: параллельная копия проекта под задачу. */
export interface WorktreeInfo {
  readonly name: string;
  readonly branch?: string;
  readonly directory: string;
}

/**
 * Управление git-worktree на стороне opencode-сервера (experimental API).
 * Сервер живёт там же, где проекты, — платформе не нужен ни git, ни файлы.
 */
export interface IWorktreeApi {
  list(directory: string): Promise<WorktreeInfo[]>;
  create(directory: string, name: string): Promise<WorktreeInfo>;
  remove(directory: string, worktreeDirectory: string): Promise<void>;
}

function authedFetch(token: string): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    fetch(input, {
      ...init,
      headers: { ...(init?.headers ?? {}), Authorization: `Basic ${token}` },
    })) as typeof fetch;
}

/** Реальный API поверх v2-клиента; клиент ленивый, один на всё. */
export class OpencodeWorktreeApi implements IWorktreeApi {
  private client?: OpencodeClientV2;

  private getClient(): OpencodeClientV2 {
    if (this.client) return this.client;
    const serverUrl = process.env.OPENCODE_SERVER_URL ?? "";
    if (!serverUrl) {
      throw new Error("opencode: OPENCODE_SERVER_URL не задан — worktree недоступны");
    }
    const headers = serverAuthHeaders();
    const password = process.env.OPENCODE_SERVER_PASSWORD ?? "";
    const username = process.env.OPENCODE_SERVER_USERNAME ?? "opencode";
    this.client = createOpencodeClientV2({
      baseUrl: serverUrl,
      ...(headers && password ? { fetch: authedFetch(Buffer.from(`${username}:${password}`).toString("base64")) } : {}),
    });
    return this.client;
  }

  async list(directory: string): Promise<WorktreeInfo[]> {
    const res = await this.getClient().worktree.list({ directory });
    if (res.error) throw new Error(`worktree list: ${this.describe(res)}`);
    return (res.data ?? []).map((wtDir) => ({
      name: wtDir.split("/").filter(Boolean).pop() ?? wtDir,
      directory: wtDir,
    }));
  }

  async create(directory: string, name: string): Promise<WorktreeInfo> {
    const res = await this.getClient().worktree.create({ directory, worktreeCreateInput: { name } });
    if (res.error) throw new Error(`worktree create "${name}": ${this.describe(res)}`);
    const info = res.data ? OpencodeWorktreeApi.toInfo(res.data) : undefined;
    if (!info?.directory) throw new Error(`worktree create "${name}": сервер не вернул директорию`);
    return info;
  }

  async remove(directory: string, worktreeDirectory: string): Promise<void> {
    const res = await this.getClient().worktree.remove({
      directory,
      worktreeRemoveInput: { directory: worktreeDirectory },
    });
    if (res.error) throw new Error(`worktree remove "${worktreeDirectory}": ${this.describe(res)}`);
  }

  private static toInfo(raw: { name: string; branch?: string; directory: string }): WorktreeInfo {
    return {
      name: raw.name,
      ...(raw.branch ? { branch: raw.branch } : {}),
      directory: raw.directory,
    };
  }

  private describe(res: { response?: { status?: number } }): string {
    return `HTTP ${res.response?.status ?? "?"}`;
  }
}
