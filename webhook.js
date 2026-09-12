import {
  WORKFLOW_PROMPT,
  createWorkflowRuntime,
  listAgents,
  runTestWorkflow,
} from "./workflow.js";

const PORT = Number(process.env.PORT ?? 8787);

const runtime = await createWorkflowRuntime();
console.log(`opencode runtime ready, starting webhook on :${PORT}`);

async function readAgent(req, url) {
  // приоритет: ?agent= в query, затем { "agent": "..." } в JSON-боди
  const fromQuery = url.searchParams.get("agent");
  if (fromQuery) return fromQuery;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (body?.agent) return String(body.agent);
    } catch {
      // тело не JSON — игнорируем, агент останется дефолтным
    }
  }
  return undefined;
}

async function handleRun(agent) {
  if (agent) {
    const known = await listAgents(runtime.client);
    if (!known.includes(agent)) {
      return Response.json(
        { ok: false, error: `unknown agent "${agent}"`, agents: known },
        { status: 400 }
      );
    }
  }
  const startedAt = Date.now();
  const { sessionId, agent: usedAgent, response } = await runTestWorkflow(
    runtime.client,
    { agent }
  );
  return Response.json({
    ok: true,
    prompt: WORKFLOW_PROMPT,
    agent: usedAgent,
    sessionId,
    response,
    durationMs: Date.now() - startedAt,
  });
}

const server = Bun.serve({
  port: PORT,
  // /run ждёт ответа LLM минутами — дефолтных 10с idleTimeout не хватает (макс. 255)
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health" && req.method === "GET") {
      return Response.json({ ok: true });
    }

    // Список агентов (включая кастомных из .opencode/agent/)
    if (url.pathname === "/agents" && req.method === "GET") {
      try {
        return Response.json({ ok: true, agents: await listAgents(runtime.client) });
      } catch (err) {
        console.error("agents failed:", err);
        return Response.json(
          { ok: false, error: String(err?.message ?? err) },
          { status: 500 }
        );
      }
    }

    // Дёрнуть workflow: POST /run (GET тоже принимаем для демо из браузера).
    // Агент на выбор: /run?agent=refactor или { "agent": "refactor" } в боди.
    if (url.pathname === "/run" && (req.method === "POST" || req.method === "GET")) {
      try {
        return await handleRun(await readAgent(req, url));
      } catch (err) {
        console.error("workflow failed:", err);
        return Response.json(
          { ok: false, error: String(err?.message ?? err) },
          { status: 500 }
        );
      }
    }

    return Response.json({ ok: false, error: "not found" }, { status: 404 });
  },
});

console.log(`webhook listening on http://localhost:${server.port}/run`);

async function shutdown() {
  console.log("shutting down webhook...");
  server.stop();
  await runtime.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
