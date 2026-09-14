import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { Ban, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RunPhaseState } from "@/lib/workflow";

export type TerminalNodeData = Record<string, unknown> & {
  status: RunPhaseState;
  error?: string;
};

export type TerminalNodeType = Node<TerminalNodeData, "terminal">;

const tone: Record<RunPhaseState, string> = {
  running: "border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  done: "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  failed: "border-red-500 bg-red-500/10 text-red-700 dark:text-red-300",
  cancelled: "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

export function TerminalNode({ data }: NodeProps<TerminalNodeType>) {
  return (
    <div className={cn("w-44 rounded-lg border p-3 text-center shadow-sm", tone[data.status])}>
      <Handle type="target" position={Position.Left} />
      {data.status === "done" && <CheckCircle2 className="mx-auto size-5" />}
      {data.status === "failed" && <XCircle className="mx-auto size-5" />}
      {data.status === "cancelled" && <Ban className="mx-auto size-5" />}
      {data.status === "running" && (
        <span className="mx-auto block size-5 animate-pulse rounded-full bg-blue-500/40" />
      )}
      <p className="mt-1 text-sm font-semibold uppercase tracking-wide">{data.status}</p>
      {data.status === "failed" && data.error && (
        <p className="mt-1 line-clamp-2 text-[11px] text-red-600/80 dark:text-red-300/70" title={data.error}>
          {data.error}
        </p>
      )}
    </div>
  );
}