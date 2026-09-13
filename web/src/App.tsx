import { useState } from "react";
import { Activity, AlertTriangle, BookOpen, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useWorkflow } from "@/lib/workflow";
import { EventLog } from "./components/EventLog";
import { PipelineGraph } from "./components/PipelineGraph";
import { RunStateBadge, Sidebar } from "./components/Sidebar";
import { cn } from "@/lib/utils";

export default function App() {
  const { state, registerAndStart, stopRun } = useWorkflow();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const selectedRun = selectedRunId ? (state.runs[selectedRunId] ?? null) : null;
  const runs = state.order.map((id) => state.runs[id]).filter(Boolean);

  const stopSelected = async () => {
    if (!selectedRun || stopping) return;
    setStopping(true);
    try {
      await stopRun(selectedRun.runId);
    } catch {
      // ошибка уже в event log
    } finally {
      setStopping(false);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-4 border-b px-4 py-2.5">
        <h1 className="text-sm font-semibold tracking-tight">opencode-workflow</h1>
        <span className="text-[11px] text-muted-foreground">module pipeline dashboard</span>
        <div className="ml-auto flex items-center gap-3">
          <ConnectionBadge connected={state.connected} />
          <span className="text-[11px] text-muted-foreground">{runs.length} run(s)</span>
          <Separator orientation="vertical" className="h-4" />
          <Button variant="ghost" size="sm" asChild>
            <a href="/openapi.yaml" target="_blank" rel="noreferrer">
              <BookOpen className="size-3.5" /> OpenAPI
            </a>
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="w-80 shrink-0 overflow-y-auto border-r p-3">
          <Sidebar
            runs={runs}
            selectedRunId={selectedRunId}
            onSelect={setSelectedRunId}
            onStart={registerAndStart}
            onStop={stopRun}
          />
        </aside>
        <main className="relative min-w-0 flex-1">
          {selectedRun && (
            <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-lg border bg-card/95 px-3 py-1.5 shadow-sm backdrop-blur">
              <RunStateBadge status={selectedRun.status} />
              <span className="max-w-64 truncate text-xs font-medium" title={selectedRun.runId}>
                {selectedRun.title}
              </span>
              {selectedRun.status === "running" && (
                <Button variant="destructive" size="xs" onClick={stopSelected} disabled={stopping}>
                  <Square className="size-3 fill-current" />
                  {stopping ? "Stopping…" : "Stop"}
                </Button>
              )}
            </div>
          )}
          <PipelineGraph run={selectedRun} />
        </main>
        <aside className="flex w-96 shrink-0 flex-col overflow-hidden border-l">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Activity className="size-4 text-muted-foreground" />
            <p className="text-xs font-medium">Event stream</p>
            <span className="ml-auto text-[10px] text-muted-foreground">{state.log.length} event(s)</span>
          </div>
          <EventLog log={state.log} />
        </aside>
      </div>
    </div>
  );
}

function ConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 px-2 py-0.5 text-[11px]",
        connected ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-muted bg-muted/50 text-muted-foreground"
      )}
    >
      {connected ? <Activity className="size-3" /> : <AlertTriangle className="size-3" />}
      {connected ? "SSE connected" : "disconnected"}
    </Badge>
  );
}