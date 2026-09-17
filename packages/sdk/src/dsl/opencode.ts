import type { INodeContext, INodeSpec } from "../protocol/node.ts";
import type { SessionSummary } from "../protocol/executor.ts";
import type { IWorkflowRuntime } from "../workflow/definition.ts";
import {
  OpencodeSessionCreateError,
  OpencodeSessionPromptError,
  OpencodeWorktreeError,
} from "../errors.ts";

/**
 * Состояние opencode-сессии в данных прогона: sessionId пишет нода
 * «создать сессию», text обновляет каждая нода «работать с сессией».
 */
export interface SessionState {
  sessionId: string;
  text: string;
}

/** Данные прогона с opencode-сессией (расширь этим свой TData). */
export interface SessionData {
  opencode?: SessionState;
}

/**
 * Данные прогона с резолвом проекта: Map-нода пишет project по лейблам
 * задачи; нет маппинга — поле не пишется, downstream гейтится condition.
 */
export interface ProjectData {
  project?: { label: string; directory: string };
}

/** Данные прогона с историей сессий проекта. */
export interface SessionHistoryData {
  opencodeSessions?: SessionSummary[];
}

/** Данные прогона с worktree: параллельной копией проекта под задачу. */
export interface WorktreeData {
  worktree?: { name: string; directory: string; branch?: string };
}

export interface OpencodeNodeOptions<TData> {
  readonly outgoing?: readonly string[];
  readonly condition?: (ctx: INodeContext<TData>) => boolean | Promise<boolean>;
}

export interface CreateSessionOptions<TData> extends OpencodeNodeOptions<TData> {
  readonly title?: string | ((ctx: INodeContext<TData>) => string);
  /** Директория проекта на сервере; пусто/undefined — cwd сервера. */
  readonly directory?: string | ((ctx: INodeContext<TData>) => string | undefined);
}

export interface SessionPromptOptions<TData> extends OpencodeNodeOptions<TData> {
  readonly prompt: string | ((ctx: INodeContext<TData>) => string);
  readonly agent?: string | ((ctx: INodeContext<TData>) => string);
  /** Директория проекта на сервере; пусто/undefined — cwd сервера. */
  readonly directory?: string | ((ctx: INodeContext<TData>) => string | undefined);
}

export interface ProjectMapOptions<TData> extends OpencodeNodeOptions<TData> {
  /** Лейблы задачи; по умолчанию — ctx.data.task.labels. */
  readonly labels?: string[] | ((ctx: INodeContext<TData>) => readonly string[] | undefined);
}

export interface SessionHistoryOptions<TData> extends OpencodeNodeOptions<TData> {
  /** Директория проекта на сервере; обычно из ctx.data.project. */
  readonly directory: string | ((ctx: INodeContext<TData>) => string | undefined);
  readonly limit?: number;
}

export interface WorktreeOptions<TData> extends OpencodeNodeOptions<TData> {
  /** Директория проекта на сервере; обычно из ctx.data.project. */
  readonly directory: string | ((ctx: INodeContext<TData>) => string | undefined);
  /** Имя worktree (идемпотентно: повторный ран переиспользует); обычно id задачи. */
  readonly name: string | ((ctx: INodeContext<TData>) => string);
}

function tail<TData>(opts: OpencodeNodeOptions<TData>): Pick<INodeSpec<TData>, "outgoing" | "condition"> {
  return {
    outgoing: opts.outgoing ?? [],
    ...(opts.condition ? { condition: opts.condition } : {}),
  };
}

/**
 * Нода «создать сессию»: пустая сессия на сервере opencode, sessionId —
 * в ctx.data.opencode. Идемпотентна: при ревизите движком существующий
 * sessionId не пересоздаётся. Подключение — через rt.executor.
 */
export function opencodeCreateSession<TData extends SessionData>(
  rt: Pick<IWorkflowRuntime, "executor">,
  id: string,
  opts: CreateSessionOptions<TData> = {}
): INodeSpec<TData> {
  return {
    id,
    ...tail(opts),
    executor: {
      run: async (ctx) => {
        const existing = ctx.data.opencode?.sessionId;
        if (existing) return ctx;
        const title = typeof opts.title === "function" ? opts.title(ctx) : (opts.title ?? "session");
        const directory = typeof opts.directory === "function" ? opts.directory(ctx) : opts.directory;
        try {
          const sessionId = await rt.executor.createSession(title, directory);
          ctx.data.opencode = { sessionId, text: "" };
        } catch (err) {
          if (err instanceof OpencodeSessionCreateError) throw err;
          throw new OpencodeSessionCreateError(title, err);
        }
        return ctx;
      },
    },
  };
}

/**
 * Данные прогона с резолвом проекта: Map-нода пишет project по лейблам
 * задачи; нет маппинга — поле не пишется, downstream гейтится condition.
 */
export interface ProjectData {
  task: { labels?: readonly string[] };
  project?: { label: string; directory: string };
}

/**
 * Нода-Datasource «карта проектов»: явный маппинг лейбл таск-менеджера →
 * директория проекта (STATE_DIR/projects.json, service "projects").
 * Первый совпавший лейбл побеждает. Нет маппинга — тихий пропуск:
 * project не пишется, дальнейшие ноды отсекаются condition.
 */
export function projectMap<TData extends ProjectData>(
  rt: Pick<IWorkflowRuntime, "commands">,
  id: string,
  opts: ProjectMapOptions<TData> = {}
): INodeSpec<TData> {
  return {
    id,
    ...tail(opts),
    executor: {
      run: async (ctx) => {
        const labels = typeof opts.labels === "function"
          ? (opts.labels(ctx) ?? [])
          : (opts.labels ?? ctx.data.task.labels ?? []);
        for (const label of labels) {
          const res = await rt.commands.execute({ service: "projects", op: "get", params: { label } });
          if (!res.ok) continue;
          const entry = (res.data as { entry?: { label: string; directory: string } }).entry;
          if (!entry) continue;
          ctx.data.project = { label: entry.label, directory: entry.directory };
          return ctx;
        }
        return ctx;
      },
    },
  };
}

/**
 * Нода «история сессий»: недавние сессии проекта с сервера
 * (для контекста в промпте и отчётности). Пишет ctx.data.opencodeSessions.
 */
export function opencodeSessionHistory<TData extends SessionHistoryData>(
  rt: Pick<IWorkflowRuntime, "executor">,
  id: string,
  opts: SessionHistoryOptions<TData>
): INodeSpec<TData> {
  return {
    id,
    ...tail(opts),
    executor: {
      run: async (ctx) => {
        const directory = typeof opts.directory === "function" ? opts.directory(ctx) : opts.directory;
        if (!directory) {
          ctx.data.opencodeSessions = [];
          return ctx;
        }
        ctx.data.opencodeSessions = await rt.executor.listSessions({
          directory,
          ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
        });
        return ctx;
      },
    },
  };
}
/**
 * Нода «работать с созданной сессией»: промпт в сессию из ctx.data.opencode,
 * ожидание ответа, text обновляется. Цепочка таких нод — мульти-тёрн:
 * контекст копится на стороне сервера.
 */
export function opencodeSessionPrompt<TData extends SessionData>(
  rt: Pick<IWorkflowRuntime, "executor">,
  id: string,
  opts: SessionPromptOptions<TData>
): INodeSpec<TData> {
  return {
    id,
    ...tail(opts),
    executor: {
      run: async (ctx) => {
        const session = ctx.data.opencode;
        if (!session?.sessionId) {
          throw new OpencodeSessionPromptError("", "нет сессии: добавь opencodeCreateSession перед этой нодой");
        }
        const prompt = typeof opts.prompt === "function" ? opts.prompt(ctx) : opts.prompt;
        const agent = typeof opts.agent === "function" ? opts.agent(ctx) : opts.agent;
        const directory = typeof opts.directory === "function" ? opts.directory(ctx) : opts.directory;
        try {
          const res = await rt.executor.runSession({
            sessionId: session.sessionId,
            prompt,
            ...(agent ? { agent } : {}),
            ...(directory ? { directory } : {}),
            signal: ctx.signal,
          });
          session.text = res.text;
        } catch (err) {
          if (err instanceof OpencodeSessionPromptError) throw err;
          throw new OpencodeSessionPromptError(session.sessionId, "промпт не выполнен", err);
        }
        return ctx;
      },
    },
  };
}

/**
 * Нода «worktree»: параллельная копия проекта под задачу (git worktree
 * делает сервер, платформе файлы не нужны). Идемпотентна: worktree с таким
 * именем переиспользуется — повторный ран карточки продолжает свою копию.
 * Пишет ctx.data.worktree = { name, directory, branch? }.
 */
export function opencodeWorktree<TData extends WorktreeData>(
  rt: Pick<IWorkflowRuntime, "commands">,
  id: string,
  opts: WorktreeOptions<TData>
): INodeSpec<TData> {
  return {
    id,
    ...tail(opts),
    executor: {
      run: async (ctx) => {
        if (ctx.data.worktree?.directory) return ctx;
        const directory = typeof opts.directory === "function" ? opts.directory(ctx) : opts.directory;
        if (!directory) {
          throw new OpencodeWorktreeError("", "нет директории проекта: добавь projectMap перед этой нодой");
        }
        const name = typeof opts.name === "function" ? opts.name(ctx) : opts.name;
        const res = await rt.commands.execute({
          service: "opencode",
          op: "worktree.ensure",
          params: { directory, name },
        });
        if (!res.ok) throw new OpencodeWorktreeError(name, res.error);
        const worktree = (res.data as { worktree?: { name: string; directory: string; branch?: string } }).worktree;
        if (!worktree?.directory) throw new OpencodeWorktreeError(name, "сервер не вернул директорию");
        ctx.data.worktree = {
          name: worktree.name,
          directory: worktree.directory,
          ...(worktree.branch ? { branch: worktree.branch } : {}),
        };
        return ctx;
      },
    },
  };
}
