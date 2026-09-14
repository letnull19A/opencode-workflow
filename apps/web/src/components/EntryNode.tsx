import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { RadioTower } from "lucide-react";
import { cn } from "@/lib/utils";

export type EntryNodeData = Record<string, unknown> & {
  source: string;
  runId: string;
};

export type EntryNodeType = Node<EntryNodeData, "entry">;

export function EntryNode({ data }: NodeProps<EntryNodeType>) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative z-10 h-16 w-16">
        <div className="flex size-16 items-center justify-center bg-gradient-to-br from-primary to-primary/70 shadow-md [clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)]">
          <RadioTower className="size-5 text-primary-foreground" />
        </div>
      </div>
      <p className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-border", "bg-background text-muted-foreground")}>
        {data.source}
      </p>
      <p className="max-w-28 truncate text-[10px] text-muted-foreground" title={data.runId}>
        entry
      </p>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}