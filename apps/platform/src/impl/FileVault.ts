import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { appendFile, chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IVault } from "@opencode-workflow/sdk";
import type { ILogger } from "../core/logging.ts";
import { makeLogger } from "./logger.ts";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const VAULT_VERSION = 1;

/** Vault закрыт: нет мастер-ключа (ни env, ни дев-фоллбэка). */
export class VaultLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultLockedError";
  }
}

/** Секрет отсутствует. Сообщение несёт только scope/key — значений нет. */
export class VaultKeyMissingError extends Error {
  readonly scope: string;
  readonly key: string;
  constructor(scope: string, key: string) {
    super(`vault: секрет "${scope}/${key}" не найден`);
    this.name = "VaultKeyMissingError";
    this.scope = scope;
    this.key = key;
  }
}

/** Не удалось расшифровать: повреждённые данные или другой мастер-ключ. */
export class VaultDecryptError extends Error {
  constructor(scope: string, key: string) {
    super(`vault: не удалось расшифровать "${scope}/${key}" (повреждённые данные или другой ключ)`);
    this.name = "VaultDecryptError";
  }
}

export interface FileVaultOptions {
  /** Каталог vault (по умолчанию $STATE_DIR/vault). */
  dir?: string;
  /** base64 32B мастер-ключ; приоритет над env VAULT_MASTER_KEY. */
  masterKeyBase64?: string;
}

interface VaultFile {
  version: number;
  secrets: Record<string, Record<string, string>>;
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

/**
 * Файловый vault: per-workflow секреты, AES-256-GCM, scope как AAD.
 * В памяти — только шифротекст (кэш с mtime/size-гардом файла), plaintext
 * живёт микросекунды между decrypt и использованием. Чтения открывают файл
 * только при изменении mtime — долгоживущих дескрипторов нет.
 */
export class FileVault implements IVault {
  private readonly file: string;
  private readonly auditFile: string;
  private readonly log: ILogger;
  private masterKey: Buffer;
  private cache: Map<string, Map<string, string>> | null = null;
  private cachedMtimeMs = -1;
  private cachedSize = -1;
  private cachedIno = -1;
  private tail: Promise<void> = Promise.resolve();

  private constructor(dir: string, masterKey: Buffer, log: ILogger) {
    this.file = join(dir, "vault.json");
    this.auditFile = join(dir, "audit.log");
    this.masterKey = masterKey;
    this.log = log;
  }

  /** Генерация мастер-ключа (base64 32B) для VAULT_MASTER_KEY. */
  static generateMasterKey(): string {
    return randomBytes(KEY_BYTES).toString("base64");
  }

  /** Открыть vault (создаёт каталог; в дев-режиме — master.key при пустом env). */
  static async open(options: FileVaultOptions = {}, log: ILogger = makeLogger("vault")): Promise<FileVault> {
    const stateDir = process.env.STATE_DIR
      ?? join(process.env.HOME ?? ".", ".local", "state", "opencode-workflow");
    const dir = options.dir ?? process.env.VAULT_DIR ?? join(stateDir, "vault");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const masterKey = await FileVault.resolveMasterKey(
      dir,
      options.masterKeyBase64 ?? process.env.VAULT_MASTER_KEY,
      log
    );
    return new FileVault(dir, masterKey, log);
  }

  async get(scope: string, key: string): Promise<string> {
    return this.exclusive(async () => {
      this.checkId(scope, "scope");
      this.checkId(key, "key");
      const entry = (await this.load()).get(scope)?.get(key);
      if (entry === undefined) throw new VaultKeyMissingError(scope, key);
      await this.audit("get", scope, key);
      return this.decrypt(scope, key, entry);
    });
  }

  async set(scope: string, key: string, value: string): Promise<void> {
    return this.exclusive(async () => {
      this.checkId(scope, "scope");
      this.checkId(key, "key");
      if (value === undefined) throw new Error(`vault: пустое значение для "${scope}/${key}"`);
      const data = await this.load();
      const blob = this.encrypt(scope, value);
      const inner = data.get(scope) ?? new Map<string, string>();
      inner.set(key, blob);
      data.set(scope, inner);
      await this.persist(data);
      await this.audit("set", scope, key);
    });
  }

  async delete(scope: string, key: string): Promise<void> {
    return this.exclusive(async () => {
      this.checkId(scope, "scope");
      this.checkId(key, "key");
      const data = await this.load();
      if (!data.get(scope)?.has(key)) throw new VaultKeyMissingError(scope, key);
      data.get(scope)?.delete(key);
      if (data.get(scope)?.size === 0) data.delete(scope);
      await this.persist(data);
      await this.audit("delete", scope, key);
    });
  }

  async list(scope: string): Promise<string[]> {
    return this.exclusive(async () => {
      this.checkId(scope, "scope");
      return [...((await this.load()).get(scope)?.keys() ?? [])];
    });
  }

  async has(scope: string, key: string): Promise<boolean> {
    return this.exclusive(async () => {
      this.checkId(scope, "scope");
      this.checkId(key, "key");
      return (await this.load()).get(scope)?.has(key) ?? false;
    });
  }

  async rotate(newMasterKeyBase64: string): Promise<void> {
    return this.exclusive(async () => {
      const next = FileVault.parseMasterKey(newMasterKeyBase64, "новый мастер-ключ");
      const current = this.masterKey;
      const plaintexts: Array<[string, string, string]> = [];
      for (const [scope, inner] of await this.load()) {
        for (const [key, blob] of inner) {
          plaintexts.push([scope, key, this.decryptWith(current, scope, key, blob)]);
        }
      }
      this.masterKey = next;
      try {
        const data = new Map<string, Map<string, string>>();
        for (const [scope, key, value] of plaintexts) {
          const inner = data.get(scope) ?? new Map<string, string>();
          inner.set(key, this.encrypt(scope, value));
          data.set(scope, inner);
        }
        await this.persist(data);
        await this.audit("rotate", "-", "-");
      } catch (err) {
        this.masterKey = current;
        throw err;
      }
      this.log.warn("vault: ключ ротирован — обновите VAULT_MASTER_KEY в env и перезапустите процесс");
    });
  }

  private static async resolveMasterKey(
    dir: string,
    raw: string | undefined,
    log: ILogger
  ): Promise<Buffer> {
    if (raw) return FileVault.parseMasterKey(raw, "VAULT_MASTER_KEY");
    const keyPath = join(dir, "master.key");
    try {
      const existing = (await readFile(keyPath, "utf8")).trim();
      if (existing) {
        log.warn(`vault: DEV-режим — VAULT_MASTER_KEY не задан, ключ из ${keyPath} (в проде — только env)`);
        return FileVault.parseMasterKey(existing, keyPath);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const generated = FileVault.generateMasterKey();
    await writeFile(keyPath, `${generated}\n`, { mode: 0o600 });
    await chmod(keyPath, 0o600);
    log.warn(`vault: DEV-режим — создан ${keyPath} (только локально, в проде задайте VAULT_MASTER_KEY)`);
    return FileVault.parseMasterKey(generated, keyPath);
  }

  private static parseMasterKey(raw: string, where: string): Buffer {
    const key = Buffer.from(raw.trim(), "base64");
    if (key.length !== KEY_BYTES) {
      throw new VaultLockedError(
        `vault: неверный мастер-ключ (${where}): нужно base64 32 байта; ` +
          `сгенерировать: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
      );
    }
    return key;
  }

  private checkId(value: string, what: string): void {
    if (!ID_RE.test(value)) {
      throw new Error(`vault: плохой ${what} "${value}" (латиница/цифры/._-, до 128 символов)`);
    }
  }

  private encrypt(scope: string, plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.masterKey, iv);
    cipher.setAAD(Buffer.from(scope, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString("base64");
  }

  private decrypt(scope: string, key: string, blob: string): string {
    try {
      return this.decryptWith(this.masterKey, scope, key, blob);
    } catch (err) {
      if (err instanceof VaultDecryptError) throw err;
      throw new VaultDecryptError(scope, key);
    }
  }

  private decryptWith(key: Buffer, scope: string, entryKey: string, blob: string): string {
    const raw = Buffer.from(blob, "base64");
    if (raw.length < IV_BYTES + TAG_BYTES) throw new VaultDecryptError(scope, entryKey);
    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(raw.length - TAG_BYTES);
    const ciphertext = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(Buffer.from(scope, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }

  private async load(): Promise<Map<string, Map<string, string>>> {
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
    const data = new Map<string, Map<string, string>>();
    if (mtimeMs >= 0) {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as VaultFile;
      if (parsed?.version !== VAULT_VERSION || typeof parsed.secrets !== "object" || parsed.secrets === null) {
        throw new Error("vault: повреждённый vault.json (версия/структура)");
      }
      for (const [scope, inner] of Object.entries(parsed.secrets)) {
        data.set(scope, new Map(Object.entries(inner)));
      }
    }
    this.cache = data;
    this.cachedMtimeMs = mtimeMs;
    this.cachedSize = size;
    this.cachedIno = ino;
    return data;
  }

  private async persist(data: Map<string, Map<string, string>>): Promise<void> {
    const secrets: Record<string, Record<string, string>> = {};
    for (const [scope, inner] of data) secrets[scope] = Object.fromEntries(inner);
    const body = JSON.stringify({ version: VAULT_VERSION, secrets }, null, 2);
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, body, { mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, this.file);
    await chmod(this.file, 0o600);
    this.cache = data;
    try {
      const st = await stat(this.file);
      this.cachedMtimeMs = st.mtimeMs;
      this.cachedSize = st.size;
      this.cachedIno = st.ino;
    } catch {
      this.cache = null;
    }
  }

  private async audit(action: string, scope: string, key: string): Promise<void> {
    const line = `${new Date().toISOString()} vault.${action} scope=${scope} key=${key}\n`;
    try {
      await appendFile(this.auditFile, line, { mode: 0o600 });
    } catch (err) {
      this.log.warn(`vault: не записался audit (${action} ${scope}/${key}): ${String(err)}`);
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
