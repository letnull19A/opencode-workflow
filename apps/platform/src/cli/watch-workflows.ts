import { stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Отдельный watcher-процесс для каталога workflow-артефактов.
 * Ходит poll'ом по WORKFLOWS_DIR (WATCHER_POLL_MS), сравнивает
 * сигнатуру (имя+размер+mtime), и при изменении зовёт платформу:
 * POST http://127.0.0.1:PORT/internal/workflows/reload с токеном
 * RELOAD_TOKEN. Платформа сама диффит и публикует workflow.* в шину.
 */
const DIR = process.env.WORKFLOWS_DIR ?? "workflows";
const PORT = Number(process.env.PORT ?? 8787);
const POLL_MS = Number(process.env.WATCHER_POLL_MS ?? 2000);
const TOKEN = process.env.RELOAD_TOKEN;
const RELOAD_URL = `http://127.0.0.1:${PORT}/internal/workflows/reload`;

type Signature = string;

let previous: Map<string, Signature> = new Map();
let reportedDown = false;

function signatureOf(st: { size: number; mtimeMs: number }): Signature {
  return `${st.size}:${Math.round(st.mtimeMs)}`;
}

/**
 * Сигнатура артефакта — по файлам index.js + manifest.json, а не по самому
 * каталогу: in-place пересборка (build-workflow) не меняет mtime каталога,
 * поэтому каталоговая сигнатура пропускала бы workflow.updated.
 */
async function fileSig(name: string): Promise<Signature | undefined> {
  const index = await stat(join(DIR, name, "index.js")).catch(() => undefined);
  const manifest = await stat(join(DIR, name, "manifest.json")).catch(() => undefined);
  if (!index && !manifest) return undefined;
  const a = index ? signatureOf(index) : "";
  const b = manifest ? signatureOf(manifest) : "";
  return `${entrySignature(name)}|${a}|${b}`;
}

function entrySignature(name: string): Signature {
  return name;
}

async function snapshot(): Promise<Map<string, Signature>> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(DIR).catch(() => []);
  const out = new Map<string, Signature>();
  for (const entry of entries) {
    const path = join(DIR, entry);
    const st = await stat(path).catch(() => undefined);
    if (st?.isDirectory()) {
      out.set(entry, (await fileSig(entry)) ?? signatureOf(st));
    }
  }
  return out;
}

function changed(a: Map<string, Signature>, b: Map<string, Signature>): boolean {
  if (a.size !== b.size) return true;
  for (const [name, sig] of a) if (b.get(name) !== sig) return true;
  return false;
}

async function notify(): Promise<void> {
  try {
    const res = await fetch(RELOAD_URL, {
      method: "POST",
      headers: { ...(TOKEN ? { "x-reload-token": TOKEN } : {}) },
    });
    reportedDown = false;
    if (!res.ok) console.error(`[watch] reload вернул ${res.status}: ${await res.text()}`);
  } catch (err) {
    if (!reportedDown) {
      console.error(`[watch] платформа недоступна на :${PORT} — жду её и продолжу поллить`);
      reportedDown = true;
      void err;
    }
  }
}

async function tick(): Promise<void> {
  const current = await snapshot();
  if (changed(previous, current)) {
    await notify();
    previous = current;
  }
}

console.log(`[watch] слежу за ${DIR} → ${RELOAD_URL}, poll ${POLL_MS}ms`);
setInterval(tick, POLL_MS);
void tick();