import { chmod, mkdir, rename, writeFile, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { IProjectMap, IProjectMapEntry } from "../core/projects.ts";
import type { ILogger } from "../core/logging.ts";
import { makeLogger } from "./logger.ts";

const MAP_VERSION = 1;

interface ProjectMapFile {
  version: number;
  map: IProjectMapEntry[];
}

const LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9_.:\/-]{0,127}$/;

/**
 * Файловая карта проектов: STATE_DIR/projects.json, явные пары
 * лейбл → директория. Атомарная запись (tmp+rename), файл 0600 —
 * пути проектов не светим в world-readable. Кэш с mtime/size/ino-гардом
 * (как FileVault): правки CLI видны следующему чтению без рестарта.
 */
export class FileProjectMap implements IProjectMap {
  private readonly file: string;
  private readonly log: ILogger;
  private cache: IProjectMapEntry[] | null = null;
  private cachedMtimeMs = -1;
  private cachedSize = -1;
  private cachedIno = -1;
  private tail: Promise<void> = Promise.resolve();

  private constructor(file: string, log: ILogger) {
    this.file = file;
    this.log = log;
  }

  static async open(options: { dir?: string } = {}, log: ILogger = makeLogger("projects")): Promise<FileProjectMap> {
    const stateDir = process.env.STATE_DIR
      ?? join(process.env.HOME ?? ".", ".local", "state", "opencode-workflow");
    const dir = options.dir ?? stateDir;
    await mkdir(dir, { recursive: true, mode: 0o700 });
    return new FileProjectMap(join(dir, "projects.json"), log);
  }

  async entries(): Promise<IProjectMapEntry[]> {
    return this.exclusive(async () => [...(await this.load())]);
  }

  async byLabel(label: string): Promise<IProjectMapEntry | null> {
    return this.exclusive(async () => {
      for (const entry of await this.load()) {
        if (entry.label === label) return { ...entry };
      }
      return null;
    });
  }

  async set(label: string, directory: string): Promise<void> {
    return this.exclusive(async () => {
      FileProjectMap.checkLabel(label);
      FileProjectMap.checkDirectory(directory);
      const entries = await this.load();
      const at = entries.findIndex((e) => e.label === label);
      if (at >= 0) entries[at] = { label, directory };
      else entries.push({ label, directory });
      await this.persist(entries);
      this.log.info(`projects: маппинг "${label}" → ${directory}`);
    });
  }

  async remove(label: string): Promise<boolean> {
    return this.exclusive(async () => {
      const entries = await this.load();
      const at = entries.findIndex((e) => e.label === label);
      if (at < 0) return false;
      entries.splice(at, 1);
      await this.persist(entries);
      this.log.info(`projects: маппинг "${label}" удалён`);
      return true;
    });
  }

  private static checkLabel(label: string): void {
    if (!LABEL_RE.test(label)) {
      throw new Error(`projects: плохой лейбл "${label}" (без пробелов, до 128 символов)`);
    }
  }

  private static checkDirectory(directory: string): void {
    if (!directory.startsWith("/") || directory.includes("..") || directory.length > 512) {
      throw new Error(`projects: плохая директория "${directory}" (нужен абсолютный путь без ..)`);
    }
  }

  private async load(): Promise<IProjectMapEntry[]> {
    let mtimeMs = -2;
    let size = -2;
    let ino = -2;
    try {
      const st = await stat(this.file);
      mtimeMs = st.mtimeMs;
      size = st.size;
      ino = st.ino;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    if (
      this.cache &&
      this.cachedMtimeMs === mtimeMs &&
      this.cachedSize === size &&
      this.cachedIno === ino
    ) {
      return this.cache;
    }
    const data: IProjectMapEntry[] = [];
    if (mtimeMs >= 0) {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as ProjectMapFile;
      if (parsed?.version !== MAP_VERSION || !Array.isArray(parsed.map)) {
        throw new Error("projects: повреждённый projects.json (версия/структура)");
      }
      for (const entry of parsed.map) {
        FileProjectMap.checkLabel(entry.label);
        FileProjectMap.checkDirectory(entry.directory);
        data.push({ label: entry.label, directory: entry.directory });
      }
    }
    this.cache = data;
    this.cachedMtimeMs = mtimeMs;
    this.cachedSize = size;
    this.cachedIno = ino;
    return data;
  }

  private async persist(entries: IProjectMapEntry[]): Promise<void> {
    const body = JSON.stringify({ version: MAP_VERSION, map: entries }, null, 2);
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, body, { mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, this.file);
    await chmod(this.file, 0o600);
    this.cache = entries;
    try {
      const st = await stat(this.file);
      this.cachedMtimeMs = st.mtimeMs;
      this.cachedSize = st.size;
      this.cachedIno = st.ino;
    } catch {
      this.cache = null;
    }
  }

  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn);
    this.tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}
