import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { PhaseStatus } from "@/lib/workflow";

export type PhaseNodeData = Record<string, unknown> & {
  label: string;
  status: PhaseStatus;
  index: number;
  total: number;
};

export type PhaseNodeType = Node<PhaseNodeData, "phase">;

const statusStyles: Record<PhaseStatus, string> = {
  pending: "border-muted bg-muted/40 text-muted-foreground",
  running: "border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  done: "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  error: "border-red-500 bg-red-500/10 text-red-700 dark:text-red-300",
};

const dotStyles: Record<PhaseStatus, string> = {
  pending: "bg-muted-foreground/40",
  running: "bg-blue-500 animate-pulse",
  done: "bg-emerald-500",
  error: "bg-red-500",
};

export function PhaseNode({ data }: NodeProps<PhaseNodeType>) {
  return (
    <div
      className={cn(
        "w-44 rounded-lg border bg-card px-3 py-2 shadow-sm",
        data.status === "running" && "ring-2 ring-blue-500/40",
        statusStyles[data.status]
      )}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-2">
        <span className={cn("size-2 rounded-full", dotStyles[data.status])} />
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {data.index + 1} / {data.total}
        </span>
      </div>
      <p className="mt-1 truncate text-sm font-semibold">{data.label}</p>
      {data.status === "running" && <p className="text-xs text-blue-600/80 dark:text-blue-300/80">running…</p>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}