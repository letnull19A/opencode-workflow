import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { Boxes } from "lucide-react";

export type TaskNodeData = Record<string, unknown> & {
  title: string;
  runId: string;
  action?: string;
  domain?: string;
};

export type TaskNodeType = Node<TaskNodeData, "task">;

export function TaskNode({ data }: NodeProps<TaskNodeType>) {
  return (
    <div className="w-60 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Boxes className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">module</p>
          <p className="truncate text-sm font-semibold">{data.title}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {data.action && (
          <span className="rounded-full bg-background px-2 py-0.5 text-[11px] font-medium text-foreground ring-1 ring-border">
            {data.action}
          </span>
        )}
        {data.domain && (
          <span className="rounded-full bg-background px-2 py-0.5 text-[11px] font-medium text-foreground ring-1 ring-border">
            {data.domain}
          </span>
        )}
      </div>
      <p className="mt-2 truncate text-[11px] text-muted-foreground" title={data.runId}>
        {data.runId}
      </p>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}