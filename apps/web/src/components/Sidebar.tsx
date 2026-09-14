import { useState, type MouseEvent } from "react";
import { Play, RadioTower, RotateCcw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ModuleAction, ModuleDomain, WorkflowStartResponse, WireWorkflow } from "@/lib/types";
import { KNOWN_ACTIONS, KNOWN_DOMAINS } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { RunInfo } from "@/lib/workflow";
import { WebhooksPanel } from "./WebhooksPanel";

export interface SidebarProps {
  runs: RunInfo[];
  selectedRunId: string | null;
  workflows: WireWorkflow[];
  onSelect: (runId: string) => void;
  onStart: (workflowId: string, title: string, meta?: Record<string, unknown>) => Promise<WorkflowStartResponse>;
  onStop: (workflowId: string, runId: string) => Promise<void>;
  onWorkflowsRefresh: () => void;
}

export function Sidebar({ runs, selectedRunId, workflows, onSelect, onStart, onStop, onWorkflowsRefresh }: SidebarProps) {
  return (
    <div className="flex h-full flex-col gap-3">
      <StartRunForm workflows={workflows} onStart={onStart} onWorkflowsRefresh={onWorkflowsRefresh} />
      <WebhooksPanel workflows={workflows} onWorkflowsRefresh={onWorkflowsRefresh} />
      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Runs</CardTitle>
          <CardDescription>Runs observed on the event bus</CardDescription>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 p-2 pt-0">
          <ScrollArea className="h-full pr-2">
            {runs.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                No runs yet. Start a workflow run — events will appear live over SSE.
              </p>
            ) : (
              <ul className="space-y-1">
                {runs.map((run) => (
                  <RunRow
                    key={run.runId}
                    run={run}
                    selected={run.runId === selectedRunId}
                    onSelect={onSelect}
                    onStop={onStop}
                  />
                ))}
              </ul>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function RunRow({
  run,
  selected,
  onSelect,
  onStop,
}: {
  run: RunInfo;
  selected: boolean;
  onSelect: (runId: string) => void;
  onStop: (workflowId: string, runId: string) => Promise<void>;
}) {
  const [stopping, setStopping] = useState(false);

  const stop = async (e: MouseEvent) => {
    e.stopPropagation();
    if (stopping) return;
    setStopping(true);
    try {
      await onStop(run.workflow ?? "module", run.runId);
    } catch {
      // ошибка уже залогирована в event log через note
    } finally {
      setStopping(false);
    }
  };

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(run.runId)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSelect(run.runId);
        }}
        className={cn(
          "w-full cursor-pointer rounded-lg border px-3 py-2 text-left transition-colors",
          selected ? "border-primary/50 bg-primary/5" : "border-transparent hover:bg-muted/60"
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-xs font-semibold">{run.title}</p>
          <span className="flex shrink-0 items-center gap-1.5">
            {run.status === "running" && (
              <button
                type="button"
                title={`Stop ${run.runId}`}
                disabled={stopping}
                onClick={(e) => void stop(e)}
                className={cn(
                  "inline-flex size-5 items-center justify-center rounded-full ring-1",
                  "bg-muted text-muted-foreground ring-border hover:bg-red-500/15 hover:text-red-600 hover:ring-red-500/40",
                  "disabled:pointer-events-none disabled:opacity-50"
                )}
              >
                <Square className="size-2.5 fill-current" />
              </button>
            )}
            <RunStateBadge status={run.status} />
          </span>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={run.runId}>
          {run.runId} {run.workflow ? `· ${run.workflow}` : ""}
        </p>
        {run.error && <p className="mt-1 line-clamp-1 text-[11px] text-red-600">{run.error}</p>}
      </div>
    </li>
  );
}

export function RunStateBadge({ status }: { status: RunInfo["status"] }) {
  const map: Record<RunInfo["status"], { label: string; className: string }> = {
    running: {
      label: "running",
      className: "bg-blue-500/15 text-blue-700 dark:text-blue-300 ring-blue-500/30",
    },
    done: {
      label: "done",
      className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30",
    },
    failed: {
      label: "failed",
      className: "bg-red-500/15 text-red-700 dark:text-red-300 ring-red-500/30",
    },
    cancelled: {
      label: "cancelled",
      className: "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30",
    },
  };
  const badge = map[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1", badge.className)}>
      {status === "running" && <RotateCcw className="size-2.5 animate-spin" />}
      {badge.label}
    </span>
  );
}

function StartRunForm({
  workflows,
  onStart,
  onWorkflowsRefresh,
}: {
  workflows: WireWorkflow[];
  onStart: SidebarProps["onStart"];
  onWorkflowsRefresh: () => void;
}) {
  const [title, setTitle] = useState("");
  const [workflow, setWorkflow] = useState("module");
  const [action, setAction] = useState<ModuleAction | "auto">("auto");
  const [domain, setDomain] = useState<ModuleDomain | "auto">("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setRunId(null);
    setBusy(true);
    try {
      const meta: Record<string, unknown> = {};
      if (action !== "auto") meta.action = action;
      if (domain !== "auto") meta.domain = domain;
      const res = await onStart(workflow, title, meta);
      setRunId(res.runId);
      setTitle("");
      setAction("auto");
      setDomain("auto");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm">Start a run</CardTitle>
        <CardDescription>
          <RadioTower className="mr-1 inline size-3" />
          POST /workflow/:id → pipeline phases stream over SSE
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5">
        <div className="space-y-1.5">
          <Label>Workflow</Label>
          <Select value={workflow} onValueChange={setWorkflow}>
            <SelectTrigger className="w-full h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {workflows.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.label ?? w.id} ({w.id})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <p className="text-[10px] text-muted-foreground">{workflows.length} workflow(s)</p>
            <button
              type="button"
              onClick={onWorkflowsRefresh}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              refresh
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="run-title">Title</Label>
          <Input
            id="run-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. User Profile"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Action (meta)</Label>
            <Select value={action} onValueChange={(v) => setAction(v as ModuleAction | "auto")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="auto" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">auto</SelectItem>
                {KNOWN_ACTIONS.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Domain (meta)</Label>
            <Select value={domain} onValueChange={(v) => setDomain(v as ModuleDomain | "auto")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="auto" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">auto</SelectItem>
                {KNOWN_DOMAINS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-2 pt-0">
        <Button onClick={submit} disabled={busy || !title.trim()}>
          <Play />
          {busy ? "Starting…" : "Start run"}
        </Button>
        {runId && (
          <p className="break-all text-[11px] text-emerald-600 dark:text-emerald-400">{runId}</p>
        )}
        {error && <p className="text-[11px] text-red-600">{error}</p>}
      </CardFooter>
    </Card>
  );
}