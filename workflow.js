import {
  createOpencodeClient,
  createOpencodeServer,
} from "@opencode-ai/sdk";

// Хардкод демо-workflow: текст промпта зафиксирован
export const WORKFLOW_PROMPT = "Test";
export const WORKFLOW_TITLE = "Test workflow";

// HTTP Basic Auth для защищённого сервера.
// Сервер включает auth при заданном OPENCODE_SERVER_PASSWORD
// (юзер по умолчанию "opencode", переопределяется OPENCODE_SERVER_USERNAME).
function serverAuthHeaders() {
  const password = process.env.OPENCODE_SERVER_PASSWORD;
  if (!password) return undefined;
  const username = process.env.OPENCODE_SERVER_USERNAME ?? "opencode";
  const token = Buffer.from(`${username}:${password}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

export async function createWorkflowRuntime() {
  const serverUrl = process.env.OPENCODE_SERVER_URL;
  const directory = process.env.OPENCODE_DIRECTORY;
  const headers = serverAuthHeaders();
  const clientOpts = {
    ...(headers ? { headers } : {}),
    ...(directory ? { directory } : {}),
  };
  let client = null;
  let server = null;

  // Attach к запущенному серверу, если задан OPENCODE_SERVER_URL
  if (serverUrl) {
    const attached = createOpencodeClient({ baseUrl: serverUrl, ...clientOpts });
    try {
      // дешёвая проверка доступности; важно: SDK в режиме "fields"
      // не бросает исключение на 401, ошибку смотрим в res.error
      const probe = await attached.app.agents();
      if (probe.error) {
        throw new Error(`server check failed, HTTP ${probe.response?.status}`);
      }
      console.log(`attached to running opencode server at ${serverUrl}`);
      client = attached;
    } catch (err) {
      console.warn(
        `cannot reach ${serverUrl}, starting own server: ${err?.message ?? err}`
      );
    }
  }

  // Своего сервера нет и attach не удался — запускаем собственный.
  // Сервер наследует process.env, поэтому при заданном
  // OPENCODE_SERVER_PASSWORD он тоже будет защищён — тот же заголовок
  // подключаем и к своему клиенту.
  if (!client) {
    server = await createOpencodeServer({
      port: 0,
      config: {
        permission: {
          edit: "allow",
          bash: "allow",
          webfetch: "allow",
          doom_loop: "allow",
          external_directory: "allow",
        },
        provider: {
          "opencode-go": {
            models: {
              "muse-spark-1.3-contributor": {
                options: { reasoningEffort: "minimal" },
              },
            },
          },
        },
      },
    });
    client = createOpencodeClient({ baseUrl: server.url, ...clientOpts });
  }

  // Авто-подтверждение permission-запросов, иначе prompt висит в фоне
  const eventsAbort = new AbortController();
  const eventsLoop = (async () => {
    try {
      const { stream } = await client.global.event({
        signal: eventsAbort.signal,
      });
      for await (const evt of stream) {
        try {
          const payload = evt?.payload;
          if (payload?.type === "permission.updated") {
            const p = payload.properties;
            if (p?.sessionID && p?.id) {
              await client.session.postSessionIdPermissionsPermissionId({
                path: { id: p.sessionID, permissionID: p.id },
                body: { response: "always" },
              });
            }
          }
        } catch {
          // игнорируем ошибки авто-апрува одиночного запроса
        }
        if (eventsAbort.signal.aborted) break;
      }
    } catch {
      // abort / обрыв SSE после завершения — норма
    }
  })();
  // чтобы unhandled rejection не ронял процесс, если фон упадёт
  eventsLoop.catch(() => {});

  return {
    client,
    async close() {
      eventsAbort.abort();
      server?.close();
    },
  };
}

// Агенты, доступные серверу (включая .opencode/agent/*.md проекта)
export async function listAgents(client) {
  const res = await client.app.agents();
  return (res.data ?? []).map((a) => a.name);
}

// Один прогон хардкод-workflow: отправить WORKFLOW_PROMPT, дождаться ответа.
// opts.agent — имя агента (например "refactor"); без него дефолтный build.
export async function runTestWorkflow(client, opts = {}) {
  const session = await client.session.create({
    body: { title: WORKFLOW_TITLE },
  });
  const sessionId = session.data.id;

  // session.prompt ждёт завершения ответа и возвращает AssistantMessage
  const result = await client.session.prompt({
    path: { id: sessionId },
    body: {
      ...(opts.agent ? { agent: opts.agent } : {}),
      parts: [{ type: "text", text: WORKFLOW_PROMPT }],
    },
  });

  const text = (result.data.parts ?? [])
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");

  return {
    sessionId,
    agent: opts.agent ?? "build",
    response: text || JSON.stringify(result.data),
  };
}
