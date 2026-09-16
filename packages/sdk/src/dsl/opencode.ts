import type { INodeContext, INodeSpec } from "../protocol/node.ts";
import type { IWorkflowRuntime } from "../workflow/definition.ts";
import { OpencodeSessionCreateError, OpencodeSessionPromptError } from "../errors.ts";

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

export interface OpencodeNodeOptions<TData> {
  readonly outgoing?: readonly string[];
  readonly condition?: (ctx: INodeContext<TData>) => boolean | Promise<boolean>;
}

export interface CreateSessionOptions<TData> extends OpencodeNodeOptions<TData> {
  readonly title?: string | ((ctx: INodeContext<TData>) => string);
}

export interface SessionPromptOptions<TData> extends OpencodeNodeOptions<TData> {
  readonly prompt: string | ((ctx: INodeContext<TData>) => string);
  readonly agent?: string | ((ctx: INodeContext<TData>) => string);
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
        try {
          const sessionId = await rt.executor.createSession(title);
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
        try {
          const res = await rt.executor.runSession({
            sessionId: session.sessionId,
            prompt,
            ...(agent ? { agent } : {}),
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
