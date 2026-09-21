import { describe, expect, test } from "bun:test";
import { GitHubConnector, pullRequestBody } from "./GitHubConnector.ts";

describe("pullRequestBody", () => {
  test("собирает чистое тело без repo и лишних полей", () => {
    expect(
      pullRequestBody({
        repo: "o/r",
        title: "T",
        head: "ai/x",
        base: "main",
        body: "B",
        draft: true,
        junk: 1,
      })
    ).toEqual({ title: "T", head: "ai/x", base: "main", body: "B", draft: true });
  });

  test("опциональные поля опускаются", () => {
    expect(pullRequestBody({ title: "T", head: "h", base: "b" })).toEqual({
      title: "T",
      head: "h",
      base: "b",
    });
  });

  test("требует title/head/base", () => {
    expect(() => pullRequestBody({ head: "h", base: "b" })).toThrow("title");
    expect(() => pullRequestBody({ title: "T", base: "b" })).toThrow("head");
    expect(() => pullRequestBody({ title: "T", head: "h" })).toThrow("base");
    expect(() => pullRequestBody({ title: "", head: "h", base: "b" })).toThrow("title");
  });
});

describe("GitHubConnector.execute", () => {
  test("unknown op → ok:false без сети", async () => {
    const c = new GitHubConnector();
    const res = await c.execute({ service: "github", op: "nope", params: {} });
    expect(res.ok).toBe(false);
  });

  test("pulls.create без title → ok:false с причиной", async () => {
    const c = new GitHubConnector();
    const res = await c.execute({
      service: "github",
      op: "pulls.create",
      params: { repo: "o/r", head: "h", base: "b" },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch("title");
  });
});
