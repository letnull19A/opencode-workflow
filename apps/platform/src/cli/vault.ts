import { FileVault } from "../impl/FileVault.ts";

/** CLI управления vault: секреты per-workflow (scope = id workflow). */
const USAGE = `vault: изолированные секреты workflow
  bun run vault set <scope> KEY=value | KEY (значение из stdin)
  bun run vault get <scope> KEY              (значение в stdout)
  bun run vault list <scope>                 (имена ключей, без значений)
  bun run vault has <scope> KEY
  bun run vault delete <scope> KEY
  bun run vault rotate                       (мастер-ключ из stdin)
  bun run vault import-env <scope> FILE      (KEY=value строки)
  bun run vault genkey                        (новый мастер-ключ в stdout)`;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function main(): Promise<void> {
  const [op, scope, rest] = process.argv.slice(2);
  const vault = await FileVault.open();
  switch (op) {
    case "genkey":
      console.log(FileVault.generateMasterKey());
      return;
    case "set": {
      if (!scope || !rest) throw new Error(USAGE);
      const eq = rest.indexOf("=");
      const key = eq < 0 ? rest : rest.slice(0, eq);
      const value = eq < 0 ? await readStdin() : rest.slice(eq + 1);
      if (!value) throw new Error("пустое значение");
      await vault.set(scope, key, value);
      console.log(`[ok] ${scope}/${key}`);
      return;
    }
    case "get":
      if (!scope || !rest) throw new Error(USAGE);
      console.log(await vault.get(scope, rest));
      return;
    case "list":
      if (!scope) throw new Error(USAGE);
      for (const key of await vault.list(scope)) console.log(key);
      return;
    case "has":
      if (!scope || !rest) throw new Error(USAGE);
      console.log((await vault.has(scope, rest)) ? "yes" : "no");
      return;
    case "delete":
      if (!scope || !rest) throw new Error(USAGE);
      await vault.delete(scope, rest);
      console.log(`[ok] ${scope}/${rest} удалён`);
      return;
    case "rotate": {
      const next = await readStdin();
      if (!next) throw new Error("новый мастер-ключ — в stdin");
      await vault.rotate(next);
      console.log("[ok] ключ ротирован — обновите VAULT_MASTER_KEY и перезапустите процесс");
      return;
    }
    case "import-env": {
      if (!scope || !rest) throw new Error(USAGE);
      const text = await Bun.file(rest).text();
      let n = 0;
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
        const i = trimmed.indexOf("=");
        const key = trimmed.slice(0, i).trim();
        const value = trimmed.slice(i + 1).trim().replace(/^["']|["']$/g, "");
        if (!key || !value) continue;
        await vault.set(scope, key, value);
        n += 1;
      }
      console.log(`[ok] импортировано ${n} секретов в ${scope}`);
      return;
    }
    default:
      throw new Error(USAGE);
  }
}

main().then(
  () => {},
  (err) => {
    console.error(String(err));
    process.exit(1);
  }
);
