import { mkdir, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { IWorkflowDefinition } from "@opencode-workflow/sdk";
import { workflowFormat, sdkVersion } from "@opencode-workflow/sdk";

/**
 * build-workflow: компиляция исходников workflow (workflows-src/*.ts) в
 * артефакты, пригодные для автозагрузки платформой.
 * 1) tsc --noEmit по workflows-src/tsconfig.json (типы проверяются на сборке,
 *    в рантайме — только гейт контракта);
 * 2) для каждого файла: импорт определения (id/label/phases из
 *    IWorkflowDefinition — default-экспорт) и статистика дубликатов id;
 * 3) Bun.build с инлайн-SDK в <WORKFLOWS_DIR>/<id>/index.js;
 * 4) manifest.json (format + sdkVersion) — контрактная мета для гейта.
 *
 * Usage: bun src/cli/build-workflow.ts [файлы...] [--out <dir>]
 * Без файлов — все *.ts из workflows-src (кроме *.test.ts).
 */
const OUT_DIR = resolve(process.env.WORKFLOWS_DIR ?? "workflows");
const SRC_DIR = resolve("workflows-src");

interface Pending {
  source: string;
  outdir: string;
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

async function listSources(explicit: string[]): Promise<string[]> {
  if (explicit.length > 0) return explicit;
  const files = await readdir(SRC_DIR).catch(() => []);
  return files.filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => resolve(SRC_DIR, f));
}

async function typecheck(): Promise<void> {
  const tsconfig = resolve(SRC_DIR, "tsconfig.json");
  const proc = Bun.spawnSync(["tsc", "--noEmit", "-p", tsconfig], { stdout: "pipe", stderr: "pipe" });
  if (!proc.success) {
    console.error(`[build-workflow] typecheck упал:\n${proc.stdout.toString()}\n${proc.stderr.toString()}`);
    process.exit(1);
  }
}

async function extract(path: string): Promise<IWorkflowDefinition> {
  const mod = (await import(`${pathToFileURL(path).href}?t=${Date.now()}`)) as {
    default?: IWorkflowDefinition;
  };
  const def = mod.default;
  if (!def || typeof def.id !== "string" || typeof def.create !== "function") {
    throw new Error(`${basename(path)}: нужен export default из defineWorkflow()`);
  }
  return def;
}

async function build(source: string, outdir: string): Promise<IWorkflowDefinition> {
  await mkdir(outdir, { recursive: true });
  const result = await Bun.build({ entrypoints: [source], outdir, naming: "index.js" });
  if (!result.success) {
    const details = result.logs.map((l) => l.message).join("\n");
    throw new Error(`Bun.build не удался: ${details}`);
  }
  const def = await extract(source);
  const manifest = {
    format: workflowFormat,
    id: def.id,
    label: def.label,
    phases: def.phases ? [...def.phases] : [],
    sdkVersion,
  };
  const { writeFile } = await import("node:fs/promises");
  await writeFile(`${outdir}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`[build-workflow] ${def.id} -> ${outdir}/index.js (sdk ${sdkVersion})`);
  return def;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const out = argValue(args, "--out");
  const outdir = out ? resolve(out) : OUT_DIR;
  const explicit = args.filter((a) => !a.startsWith("--"));

  const sources = await listSources(explicit);
  if (sources.length === 0) {
    console.error("[build-workflow] нет исходников (workflows-src/*.ts или явные файлы)");
    process.exit(1);
  }

  await typecheck();

  const seen = new Map<string, string>();
  const pending: Pending[] = [];
  for (const source of sources) {
    const def = await extract(source);
    const clash = seen.get(def.id);
    if (clash) {
      console.error(`[build-workflow] дубликат id "${def.id}" в ${clash} и ${source}`);
      process.exit(1);
    }
    seen.set(def.id, source);
    pending.push({ source, outdir: resolve(outdir, def.id) });
  }

  for (const item of pending) {
    try {
      await build(item.source, item.outdir);
    } catch (err) {
      console.error(`[build-workflow] ${basename(item.source)}: ${String(err)}`);
      process.exitCode = 1;
    }
  }
}

void main();