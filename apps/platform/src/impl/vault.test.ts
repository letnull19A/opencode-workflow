import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FileVault,
  VaultDecryptError,
  VaultKeyMissingError,
  VaultLockedError,
} from "./FileVault.ts";
import type { ILogger } from "../core/logging.ts";

const silent: ILogger = {
  level: "silent",
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
};
function noop(..._args: unknown[]): void {}

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

async function freshDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "vault-"));
}

async function openVault(dir: string): Promise<FileVault> {
  return FileVault.open({ dir, masterKeyBase64: FileVault.generateMasterKey() }, silent);
}

describe("FileVault", () => {
  test("roundtrip set/get в своём scope", async () => {
    const dir = await freshDir();
    try {
      const vault = await openVault(dir);
      await vault.set("wf-a", "TOKEN", "s3cr3t-value");
      expect(await vault.get("wf-a", "TOKEN")).toBe("s3cr3t-value");
      expect(await vault.has("wf-a", "TOKEN")).toBe(true);
      expect(await vault.has("wf-a", "OTHER")).toBe(false);
      expect(await vault.list("wf-a")).toEqual(["TOKEN"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("get/delete несуществующего бросает VaultKeyMissing без значения", async () => {
    const dir = await freshDir();
    try {
      const vault = await openVault(dir);
      const err = await vault.get("wf-a", "NOPE").then(
        () => null,
        (e: unknown) => e
      );
      expect(err).toBeInstanceOf(VaultKeyMissingError);
      expect(String(err)).not.toContain("s3cr3t");
      await expect(vault.delete("wf-a", "NOPE")).rejects.toBeInstanceOf(VaultKeyMissingError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("AAD-изоляция: шифротекст чужого scope не расшифровывается", async () => {
    const dir = await freshDir();
    try {
      const vault = await openVault(dir);
      await vault.set("wf-a", "TOKEN", "value-a");
      await vault.set("wf-b", "TOKEN", "value-b");
      expect(await vault.get("wf-b", "TOKEN")).toBe("value-b");
      const raw = JSON.parse(await readFile(join(dir, "vault.json"), "utf8")) as {
        secrets: Record<string, Record<string, string>>;
      };
      raw.secrets["wf-b"]!["TOKEN"] = raw.secrets["wf-a"]!["TOKEN"]!;
      await writeFile(join(dir, "vault.json"), JSON.stringify({ version: 1, secrets: raw.secrets }));
      await expect(vault.get("wf-b", "TOKEN")).rejects.toBeInstanceOf(VaultDecryptError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("B: второй инстанс видит изменения первого без рестарта (mtime-guard)", async () => {
    const dir = await freshDir();
    try {
      const key = FileVault.generateMasterKey();
      const v1 = await FileVault.open({ dir, masterKeyBase64: key }, silent);
      const v2 = await FileVault.open({ dir, masterKeyBase64: key }, silent);
      await v1.set("wf-a", "TOKEN", "one");
      expect(await v2.get("wf-a", "TOKEN")).toBe("one");
      await v2.set("wf-a", "TOKEN", "two");
      expect(await v1.get("wf-a", "TOKEN")).toBe("two");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("master.key дев-фоллбэк: создаётся с 0600 при пустом env", async () => {
    const dir = await freshDir();
    try {
      delete process.env.VAULT_MASTER_KEY;
      const vault = await FileVault.open({ dir }, silent);
      await vault.set("wf-a", "K", "v");
      expect(await vault.get("wf-a", "K")).toBe("v");
      const mode = (await stat(join(dir, "master.key"))).mode & 0o777;
      expect(mode).toBe(0o600);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("кривой мастер-ключ бросает VaultLockedError с инструкцией", async () => {
    const dir = await freshDir();
    try {
      await expect(FileVault.open({ dir, masterKeyBase64: "short" }, silent)).rejects.toBeInstanceOf(
        VaultLockedError
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rotate: данные читаются новым ключом, старым — нет", async () => {
    const dir = await freshDir();
    try {
      const oldKey = FileVault.generateMasterKey();
      const newKey = FileVault.generateMasterKey();
      const vault = await FileVault.open({ dir, masterKeyBase64: oldKey }, silent);
      await vault.set("wf-a", "TOKEN", "keep-me");
      await vault.rotate(newKey);
      expect(await vault.get("wf-a", "TOKEN")).toBe("keep-me");
      const reopened = await FileVault.open({ dir, masterKeyBase64: newKey }, silent);
      expect(await reopened.get("wf-a", "TOKEN")).toBe("keep-me");
      const stale = await FileVault.open({ dir, masterKeyBase64: oldKey }, silent);
      await expect(stale.get("wf-a", "TOKEN")).rejects.toBeInstanceOf(VaultDecryptError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("audit пишет действия без значений", async () => {
    const dir = await freshDir();
    try {
      const vault = await openVault(dir);
      await vault.set("wf-a", "TOKEN", "top-secret-123");
      await vault.get("wf-a", "TOKEN");
      await vault.delete("wf-a", "TOKEN");
      const audit = await readFile(join(dir, "audit.log"), "utf8");
      expect(audit).toContain("vault.set scope=wf-a key=TOKEN");
      expect(audit).toContain("vault.get scope=wf-a key=TOKEN");
      expect(audit).toContain("vault.delete scope=wf-a key=TOKEN");
      expect(audit).not.toContain("top-secret-123");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("плохие scope/key отклоняются", async () => {
    const dir = await freshDir();
    try {
      const vault = await openVault(dir);
      await expect(vault.set("", "K", "v")).rejects.toThrow();
      await expect(vault.set("wf/a", "K", "v")).rejects.toThrow();
      await expect(vault.set("wf-a", "..", "v")).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("vault.json пишется с правами 0600", async () => {
    const dir = await freshDir();
    try {
      const vault = await openVault(dir);
      await vault.set("wf-a", "TOKEN", "v");
      const mode = (await stat(join(dir, "vault.json"))).mode & 0o777;
      expect(mode).toBe(0o600);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
