import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename } from "node:path";
import type { IDelivery, IDeliveryRequest, IDeliveryResult } from "../core/delivery.ts";

const exec = promisify(execFile);

interface ScriptPaths {
  commit: string;
  push: string;
}

function resolveScripts(platformRoot: string): ScriptPaths {
  return {
    commit: `${platformRoot}/.opencode/scripts/deliver/commit.sh`,
    push: `${platformRoot}/.opencode/scripts/push/run.sh`,
  };
}

/**
 * Программная доставка результата рана: коммит (deliver/commit.sh) +
 * опциональный пуш (push/run.sh, DELIVERY_PUSH=1). Git агент не трогает —
 * только скрипты пака, как и предписывают правила.
 */
export class ScriptDelivery implements IDelivery {
  constructor(
    private readonly workDir: string,
    private readonly scripts?: ScriptPaths
  ) {}

  async deliver(req: IDeliveryRequest, signal?: AbortSignal): Promise<IDeliveryResult> {
    const scripts = this.scripts ?? resolveScripts(this.workDir);
    const message = `${req.task.title} — run ${basename(req.runId)}`;
    try {
      const commitOut = await exec("bash", [scripts.commit, "--message", message], {
        cwd: req.directory,
        signal,
      });
      const committed = !commitOut.stdout.includes("нечего коммитить");
      const commit = committed ? await this.lastCommit(req.directory) : undefined;

      if (process.env.DELIVERY_PUSH === "1") {
        await exec("bash", [scripts.push], { cwd: req.directory, signal });
        return { runId: req.runId, committed, pushed: true, commit };
      }
      return { runId: req.runId, committed, pushed: false, commit };
    } catch (err) {
      return { runId: req.runId, committed: false, pushed: false, error: String(err) };
    }
  }

  private async lastCommit(directory: string): Promise<string | undefined> {
    try {
      const { stdout } = await exec("git", ["rev-parse", "--short", "HEAD"], { cwd: directory });
      return stdout.trim();
    } catch {
      return undefined;
    }
  }
}