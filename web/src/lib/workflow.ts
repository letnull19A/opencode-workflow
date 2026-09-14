import { useReducer, useEffect, useCallback } from "react";
import type { WireEvent, ModuleAction, ModuleDomain, PipelinePhase } from "./types";
import { ACTION_PHASES } from "./types";
import { startModule, stopModule } from "./api";

/** Статус фазы в графе пайплайна. */
export type PhaseStatus = "pending" | "running" | "done" | "error";

export type RunPhaseState = "running" | "done" | "failed" | "cancelled";

export interface RunInfo {
  runId: string;
  title: string;
  action?: ModuleAction;
  domain?: ModuleDomain;
  source?: string;
  status: RunPhaseState;
  currentPhase?: PipelinePhase;
  phaseOrder: PipelinePhase[];
  phases: Partial<Record<PipelinePhase, PhaseStatus>>;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface LogEntry {
  id: number;
  ts: number;
  severity: "info" | "success" | "error" | "accent" | "muted";
  text: string;
}

export interface WorkflowState {
  runs: Record<string, RunInfo>;
  order: string[];
  log: LogEntry[];
  connected: boolean;
}

type Action =
  | { type: "snapshot"; events: WireEvent[]; ts: number }
  | { type: "event"; event: WireEvent; ts: number }
  | { type: "registered"; runId: string; title: string; action?: ModuleAction; domain?: ModuleDomain; ts: number }
  | { type: "note"; text: string; severity: LogEntry["severity"]; ts: number }
  | { type: "sse"; status: "connected" | "disconnected" };

const LOG_LIMIT = 500;

let nextLogId = 1;

function makeRun(runId: string, patch: Partial<RunInfo> = {}): RunInfo {
  const action = patch.action;
  const ts = Date.now();
  return {
    runId,
    status: "running",
    action,
    domain: patch.domain,
    source: patch.source,
    title: patch.title ?? runId.replace(/^run-[^-]+-/, ""),
    phaseOrder: action ? [...ACTION_PHASES[action]] : [],
    phases: action ? Object.fromEntries(ACTION_PHASES[action].map((p) => [p, "pending"])) : {},
    createdAt: ts,
    updatedAt: ts,
  };
}

function phaseLabel(phase: PipelinePhase): string {
  return `phase ${phase}`;
}

function pushLog(state: WorkflowState, entry: Omit<LogEntry, "id">): WorkflowState {
  const log = [...state.log, { ...entry, id: nextLogId++ }];
  if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT);
  return { ...state, log };
}

function normalize(run: RunInfo, raw?: RunInfo): RunInfo {
  if (!raw) return run;
  return {
    ...run,
    title: raw.title || run.title,
    action: run.action ?? raw.action,
    domain: run.domain ?? raw.domain,
    source: run.source ?? raw.source,
  };
}

function rebuildFromEvents(events: WireEvent[], previous: RunInfo[]): Record<string, RunInfo> {
  const runs: Record<string, RunInfo> = {};
  for (const event of events) {
    let runId = "";
    if (event.type === "task.received") {
      runId = `run-${event.task.source}-${event.task.externalId}`;
      const existing = runs[runId];
      if (!existing) {
        runs[runId] = makeRun(runId, { title: event.task.title, source: event.task.source });
      } else {
        runs[runId] = { ...existing, title: event.task.title, source: event.task.source };
      }
    }
    if (event.type === "pipeline.started") {
      runId = event.runId;
      const existing = runs[runId];
      if (!existing) {
        runs[runId] = makeRun(runId, {
          title: event.task.title,
          source: event.task.source,
          action: event.action,
          domain: event.domain,
        });
      } else {
        runs[runId] = {
          ...existing,
          title: event.task.title,
          source: event.task.source,
          action: existing.action ?? event.action,
          domain: existing.domain ?? event.domain,
        };
      }
    }
    if (event.type === "pipeline.phase") {
      const run = runs[event.runId] ?? makeRun(event.runId);
      const prev = run.currentPhase;
      const phases = { ...run.phases };
      if (prev && prev !== event.phase && phases[prev] === "running") {
        phases[prev] = "done";
      }
      phases[event.phase] = "running";
      const phaseOrder = run.phaseOrder.includes(event.phase)
        ? run.phaseOrder
        : [...run.phaseOrder, event.phase];
      runs[event.runId] = {
        ...run,
        phases,
        phaseOrder,
        currentPhase: event.phase,
        updatedAt: Date.now(),
      };
    }
    if (event.type === "pipeline.done") {
      const run = runs[event.runId] ?? makeRun(event.runId);
      const phases: RunInfo["phases"] = {};
      for (const phase of run.phaseOrder) phases[phase] = "done";
      if (run.currentPhase && !run.phaseOrder.includes(run.currentPhase)) {
        phases[run.currentPhase] = "done";
      }
      runs[event.runId] = { ...run, phases, status: "done", updatedAt: Date.now() };
    }
    if (event.type === "pipeline.failed") {
      const run = runs[event.runId] ?? makeRun(event.runId);
      const phases = { ...run.phases };
      if (run.currentPhase && phases[run.currentPhase] === "running") {
        phases[run.currentPhase] = "error";
      }
      runs[event.runId] = {
        ...run,
        phases,
        status: "failed",
        error: event.error,
        updatedAt: Date.now(),
      };
    }
    if (event.type === "pipeline.cancelled") {
      const run = runs[event.runId] ?? makeRun(event.runId);
      const phases = { ...run.phases };
      if (run.currentPhase && phases[run.currentPhase] === "running") {
        phases[run.currentPhase] = "pending";
      }
      runs[event.runId] = {
        ...run,
        phases,
        status: "cancelled",
        error: undefined,
        updatedAt: Date.now(),
      };
    }
  }
  for (const previousRun of previous) {
    const raw = runs[previousRun.runId];
    if (raw) runs[previousRun.runId] = normalize(raw, previousRun);
  }
  return runs;
}

function orderOf(runs: Record<string, RunInfo>, prior: string[]): string[] {
  const ids = Object.keys(runs);
  const seen = new Set<string>(prior);
  for (const id of ids) seen.delete(id);
  const newly = ids.filter((id) => !prior.includes(id)).sort((a, b) => runs[b].createdAt - runs[a].createdAt);
  return [...newly, ...prior.filter((id) => runs[id])];
}

function reducer(state: WorkflowState, action: Action): WorkflowState {
  switch (action.type) {
    case "sse":
      return { ...state, connected: action.status === "connected" };

    case "registered": {
      let runs = state.runs;
      let order = state.order;
      if (!runs[action.runId]) {
        runs = { ...runs, [action.runId]: makeRun(action.runId, {
          title: action.title,
          action: action.action,
          domain: action.domain,
        }) };
        order = [action.runId, ...order];
      } else {
        const run = runs[action.runId];
        runs = {
          ...runs,
          [action.runId]: {
            ...run,
            title: action.title,
            action: run.action ?? action.action,
            domain: run.domain ?? action.domain,
            updatedAt: Date.now(),
          },
        };
      }
      return pushLog(
        { ...state, runs, order },
        {
          ts: action.ts,
          severity: "accent",
          text: `started "${action.title}" → ${action.runId}${action.action ? ` [${action.action}]` : ""}${action.domain ? ` · ${action.domain}` : ""}`,
        }
      );
    }

    case "event": {
      const event = action.event;

      if (event.type === "task.received") {
        const runId = `run-${event.task.source}-${event.task.externalId}`;
        const run = state.runs[runId];
        const runs = {
          ...state.runs,
          [runId]: run
            ? { ...run, title: event.task.title, source: event.task.source, updatedAt: action.ts }
            : makeRun(runId, { title: event.task.title, source: event.task.source }),
        };
        const order = runs[runId] && !state.order.includes(runId) ? [runId, ...state.order] : state.order;
        return pushLog(
          { ...state, runs, order },
          { ts: action.ts, severity: "info", text: `task received: "${event.task.title}" (${event.task.source})` }
        );
      }

if (event.type === "pipeline.started") {
        const run = state.runs[event.runId];
        const runs = {
          ...state.runs,
          [event.runId]: run
            ? { ...run, title: event.task.title, source: event.task.source, action: run.action ?? event.action, domain: run.domain ?? event.domain, updatedAt: action.ts }
            : makeRun(event.runId, {
                title: event.task.title,
                source: event.task.source,
                action: event.action,
                domain: event.domain,
              }),
        };
        const order = runs[event.runId] && !state.order.includes(event.runId) ? [event.runId, ...state.order] : state.order;
        return pushLog(
          { ...state, runs, order },
          { ts: action.ts, severity: "accent", text: `${event.runId} → pipeline.started` }
        );
      }

      if (event.type === "pipeline.phase") {
        const run = state.runs[event.runId] ?? makeRun(event.runId);
        const prev = run.currentPhase;
        const phases = { ...run.phases };
        if (prev && prev !== event.phase && phases[prev] === "running") {
          phases[prev] = "done";
        }
        phases[event.phase] = "running";
        const phaseOrder = run.phaseOrder.includes(event.phase) ? run.phaseOrder : [...run.phaseOrder, event.phase];
        const runs = {
          ...state.runs,
          [event.runId]: { ...run, phases, phaseOrder, currentPhase: event.phase, updatedAt: action.ts },
        };
        return pushLog(
          { ...state, runs },
          { ts: action.ts, severity: "accent", text: `${event.runId} → ${phaseLabel(event.phase)}` }
        );
      }

      if (event.type === "pipeline.done") {
        const run = state.runs[event.runId] ?? makeRun(event.runId);
        const phases: RunInfo["phases"] = {};
        for (const phase of run.phaseOrder) phases[phase] = "done";
        if (run.currentPhase && !run.phaseOrder.includes(run.currentPhase)) phases[run.currentPhase] = "done";
        const updated: RunInfo = {
          ...run,
          phases,
          status: "done",
          error: undefined,
          updatedAt: action.ts,
        };
        const runs = { ...state.runs, [event.runId]: updated };
        return pushLog(
          { ...state, runs },
          { ts: action.ts, severity: "success", text: `${event.runId} → done` }
        );
      }

      if (event.type === "pipeline.failed") {
        const run = state.runs[event.runId] ?? makeRun(event.runId);
        const phases = { ...run.phases };
        if (run.currentPhase && phases[run.currentPhase] === "running") {
          phases[run.currentPhase] = "error";
        }
        const updated: RunInfo = {
          ...run,
          phases,
          status: "failed",
          error: event.error,
          updatedAt: action.ts,
        };
        const runs = { ...state.runs, [event.runId]: updated };
        return pushLog(
          { ...state, runs },
          { ts: action.ts, severity: "error", text: `${event.runId} → failed: ${event.error}` }
        );
      }

      if (event.type === "pipeline.cancelled") {
        const run = state.runs[event.runId] ?? makeRun(event.runId);
        const phases = { ...run.phases };
        if (run.currentPhase && phases[run.currentPhase] === "running") {
          phases[run.currentPhase] = "pending";
        }
        const updated: RunInfo = {
          ...run,
          phases,
          status: "cancelled",
          error: undefined,
          updatedAt: action.ts,
        };
        const runs = { ...state.runs, [event.runId]: updated };
        return pushLog(
          { ...state, runs },
          { ts: action.ts, severity: "muted", text: `${event.runId} → cancelled` }
        );
      }

      if (event.type === "pipeline.delivered") {
        const committed = event.commit ? `commit=${event.commit}` : "commit=∅";
        return pushLog(
          state,
          { ts: action.ts, severity: "success", text: `${event.runId} → delivered (${committed}, pushed=${event.pushed})` }
        );
      }

      if (event.type === "pipeline.delivery_failed") {
        return pushLog(
          state,
          { ts: action.ts, severity: "error", text: `${event.runId} → delivery failed: ${event.error}` }
        );
      }

      if (event.type === "entrypoint.ignored") {
        const hook = event.hookId ?? "?";
        const detail = event.detail ? ` ${event.detail}` : "";
        const severity: LogEntry["severity"] = event.reason === "duplicate_delivery" ? "muted" : "error";
        return pushLog(
          state,
          { ts: action.ts, severity, text: `webhook ${hook} ignored → ${event.reason}${detail}` }
        );
      }
      return state;
    }

    case "note": {
      return pushLog(state, { ts: action.ts, severity: action.severity, text: action.text });
    }

    case "snapshot": {
      const runs = rebuildFromEvents(action.events, Object.values(state.runs));
      const order = orderOf(runs, state.order);
      const note: LogEntry = {
        id: nextLogId++,
        ts: action.ts,
        severity: "muted",
        text: `snapshot replayed ${action.events.length} event(s)`,
      };
      return {
        ...state,
        runs,
        order,
        log: [...state.log, note].slice(-LOG_LIMIT),
      };
    }
  }
}

export function useWorkflow() {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    runs: {},
    order: [],
    log: [],
    connected: false,
  }));

  useEffect(() => {
    const es = new EventSource("/stream");

    es.addEventListener("open", () => dispatch({ type: "sse", status: "connected" }));
    es.addEventListener("error", () => dispatch({ type: "sse", status: "disconnected" }));

    const wire = <T extends WireEvent["type"]>(source: T) => (message: MessageEvent<string>) => {
      try {
        const event = JSON.parse(message.data) as Extract<WireEvent, { type: T }>;
        dispatch({ type: "event", event, ts: Date.now() });
      } catch {
        // не-валидный фрейм пропускаем
      }
    };

    es.addEventListener("snapshot", (message: MessageEvent<string>) => {
      try {
        const data = JSON.parse(message.data) as { events: WireEvent[]; ts: number };
        dispatch({ type: "snapshot", events: data.events, ts: data.ts ?? Date.now() });
      } catch {
        // ignore
      }
    });
    es.addEventListener("task.received", wire("task.received"));
    es.addEventListener("pipeline.started", wire("pipeline.started"));
    es.addEventListener("pipeline.phase", wire("pipeline.phase"));
    es.addEventListener("pipeline.done", wire("pipeline.done"));
    es.addEventListener("pipeline.failed", wire("pipeline.failed"));
    es.addEventListener("pipeline.cancelled", wire("pipeline.cancelled"));
    es.addEventListener("pipeline.delivered", wire("pipeline.delivered"));
    es.addEventListener("pipeline.delivery_failed", wire("pipeline.delivery_failed"));
    es.addEventListener("entrypoint.ignored", wire("entrypoint.ignored"));

    return () => {
      es.close();
      dispatch({ type: "sse", status: "disconnected" });
    };
  }, []);

  const registerAndStart = useCallback(
    async (title: string, action?: ModuleAction, domain?: ModuleDomain) => {
      const titleClean = title.trim();
      if (!titleClean) throw new Error("title is required");
      const res = await startModule(titleClean, domain, action);
      dispatch({
        type: "registered",
        runId: res.runId,
        title: titleClean,
        action: res.action ?? action,
        domain: res.domain ?? domain,
        ts: Date.now(),
      });
      return res;
    },
    []
  );

  const stopRun = useCallback(async (runId: string) => {
    try {
      await stopModule(runId);
      dispatch({
        type: "note",
        text: `stop requested → ${runId}`,
        severity: "muted",
        ts: Date.now(),
      });
    } catch (err) {
      dispatch({
        type: "note",
        text: `stop ${runId}: ${err instanceof Error ? err.message : String(err)}`,
        severity: "error",
        ts: Date.now(),
      });
      throw err;
    }
  }, []);

  return { state, registerAndStart, stopRun };
}

export type { Action as WorkflowAction };