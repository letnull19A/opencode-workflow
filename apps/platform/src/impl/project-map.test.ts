import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileProjectMap } from "./FileProjectMap.ts";
import { ProjectsConnector } from "./ProjectsConnector.ts";

async function openMap(): Promise<{ dir: string; map: FileProjectMap }> {
  const dir = await mkdtemp(join(tmpdir(), "pmap-"));
  return { dir, map: await FileProjectMap.open({ dir }) };
}

describe("FileProjectMap", () => {
  test("set/get/list/remove пар лейбл → директория", async () => {
    const { dir, map } = await openMap();
    try {
      await map.set("speka", "/work/projects/speka");
      await map.set("web2bizz", "/work/projects/web2bizz");
      expect(await map.byLabel("speka")).toEqual({ label: "speka", directory: "/work/projects/speka" });
      expect(await map.byLabel("nope")).toBeNull();
      expect(await map.entries()).toHaveLength(2);
      expect(await map.remove("speka")).toBe(true);
      expect(await map.remove("speka")).toBe(false);
      expect(await map.entries()).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("перезапись пары и алиасы на одну директорию", async () => {
    const { dir, map } = await openMap();
    try {
      await map.set("speka", "/work/a");
      await map.set("speka", "/work/b");
      await map.set("speka-old", "/work/b");
      expect(await map.byLabel("speka")).toEqual({ label: "speka", directory: "/work/b" });
      expect((await map.entries()).filter((e) => e.directory === "/work/b")).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("плохие лейбл/директория отклоняются", async () => {
    const { dir, map } = await openMap();
    try {
      await expect(map.set("", "/work/a")).rejects.toThrow();
      await expect(map.set("has space", "/work/a")).rejects.toThrow();
      await expect(map.set("speka", "relative/path")).rejects.toThrow();
      await expect(map.set("speka", "/work/../evil")).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("второй инстанс видит записи первого (mtime-guard)", async () => {
    const { dir, map: first } = await openMap();
    try {
      await first.set("speka", "/work/a");
      const second = await FileProjectMap.open({ dir });
      expect(await second.byLabel("speka")).toEqual({ label: "speka", directory: "/work/a" });
      await second.set("speka", "/work/b");
      expect(await first.byLabel("speka")).toEqual({ label: "speka", directory: "/work/b" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("ProjectsConnector", () => {
  test("ops list/get/set/remove", async () => {
    const { dir, map } = await openMap();
    try {
      const connector = new ProjectsConnector(map);
      expect(connector.service).toBe("projects");
      expect(connector.canHandle("projects")).toBe(true);
      const set = await connector.execute({
        service: "projects",
        op: "set",
        params: { label: "speka", directory: "/work/speka" },
      });
      expect(set.ok).toBe(true);
      const get = await connector.execute({ service: "projects", op: "get", params: { label: "speka" } });
      expect(get).toEqual({
        ok: true,
        data: { entry: { label: "speka", directory: "/work/speka" } },
      });
      const miss = await connector.execute({ service: "projects", op: "get", params: { label: "nope" } });
      expect(miss.ok).toBe(false);
      const list = await connector.execute({ service: "projects", op: "list", params: {} });
      expect(list).toEqual({ ok: true, data: { entries: [{ label: "speka", directory: "/work/speka" }] } });
      const bad = await connector.execute({ service: "projects", op: "nope", params: {} });
      expect(bad.ok).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
