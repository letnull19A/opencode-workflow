import { FileProjectMap } from "../impl/FileProjectMap.ts";

/** CLI карты проектов: явный маппинг лейбл таск-менеджера → директория в контейнере. */
const USAGE = `projects: маппинг лейбл → директория проекта
  bun run projects add <label> <directory>   (абсолютный путь в контейнере)
  bun run projects list
  bun run projects remove <label>`;

async function main(): Promise<void> {
  const [op, label, directory] = process.argv.slice(2);
  const map = await FileProjectMap.open();
  switch (op) {
    case "add":
      if (!label || !directory) throw new Error(USAGE);
      await map.set(label, directory);
      console.log(`[ok] "${label}" → ${directory}`);
      return;
    case "list": {
      const entries = await map.entries();
      if (!entries.length) console.log("(пусто)");
      for (const e of entries) console.log(`${e.label} → ${e.directory}`);
      return;
    }
    case "remove":
      if (!label) throw new Error(USAGE);
      console.log((await map.remove(label)) ? `[ok] "${label}" удалён` : `нет маппинга для "${label}"`);
      return;
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
