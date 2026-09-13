import { useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import { Workflow } from "lucide-react";
import type { RunInfo } from "@/lib/workflow";
import type { PipelinePhase } from "@/lib/types";
import { PhaseNode, type PhaseNodeData } from "./PhaseNode";
import { TaskNode, type TaskNodeData } from "./TaskNode";
import { TerminalNode, type TerminalNodeData } from "./TerminalNode";

const nodeTypes = {
  task: TaskNode,
  phase: PhaseNode,
  terminal: TerminalNode,
} satisfies NodeTypes;

const NODE_GAP = 236;
const START_X = 24;
const CENTER_Y = 0;

interface PipelineGraphProps {
  run: RunInfo | null;
}

export function PipelineGraph({ run }: PipelineGraphProps) {
  return (
    <ReactFlowProvider>
      <InnerGraph run={run} />
    </ReactFlowProvider>
  );
}

function InnerGraph({ run }: PipelineGraphProps) {
  const nodes = useMemo(() => buildNodes(run), [run]);
  const edges = useMemo(() => buildEdges(run), [run]);

  if (!run) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center text-muted-foreground">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <Workflow className="size-6" />
          </div>
          <p className="text-sm">
            Start a module run to see its pipeline, or pick a run from the list. Live phase transitions arrive over SSE.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.25 }}
      minZoom={0.4}
      nodesDraggable
      panOnScroll
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Controls position="bottom-right" />
      <MiniMap pannable zoomable className="!bg-card/80" maskColor="rgba(0,0,0,0.08)" />
    </ReactFlow>
  );
}

function buildNodes(run: RunInfo | null): Node[] {
  if (!run) return [];
  const nodes: Node[] = [];
  const phases: PipelinePhase[] =
    run.phaseOrder.length > 0
      ? run.phaseOrder
      : ["spec", "planning", "tests", "implementation", "verification"];

  nodes.push({
    id: `task-${run.runId}`,
    type: "task",
    position: { x: START_X, y: CENTER_Y - 34 },
    data: {
      title: run.title,
      runId: run.runId,
      action: run.action,
      domain: run.domain,
    } satisfies TaskNodeData,
  });

  phases.forEach((phase, index) => {
    nodes.push({
      id: `phase-${run.runId}-${phase}`,
      type: "phase",
      position: { x: START_X + NODE_GAP * (index + 1), y: CENTER_Y - 28 },
      data: {
        label: phase,
        status: run.phases[phase] ?? "pending",
        index,
        total: phases.length,
      } satisfies PhaseNodeData,
    });
  });

  const terminalX = START_X + NODE_GAP * (phases.length + 1);
  nodes.push({
    id: `terminal-${run.runId}`,
    type: "terminal",
    position: { x: terminalX, y: CENTER_Y - 30 },
    data: {
      status: run.status,
      error: run.error,
    } satisfies TerminalNodeData,
  });

  return nodes;
}

function buildEdges(run: RunInfo | null): Edge[] {
  if (!run) return [];
  const phases: PipelinePhase[] =
    run.phaseOrder.length > 0
      ? run.phaseOrder
      : ["spec", "planning", "tests", "implementation", "verification"];
  const edges: Edge[] = [];

  const via = (phase: string) => `phase-${run.runId}-${phase}`;
  const from = (phase: string | null): string => (phase ? via(phase) : `task-${run.runId}`);

  const chain: Array<{ from: string; to: string }> = [];
  for (let i = 0; i < phases.length; i++) {
    chain.push({ from: from(phases[i - 1] ?? null), to: via(phases[i]) });
  }
  chain.push({ from: from(phases[phases.length - 1] ?? null), to: `terminal-${run.runId}` });

  for (const { from: source, to: target } of chain) {
    const activeTarget =
      run.status === "running"
        ? run.currentPhase
          ? `phase-${run.runId}-${run.currentPhase}`
          : `task-${run.runId}`
        : `terminal-${run.runId}`;
    const stroke = run.status === "failed" ? "#ef4444" : run.status === "cancelled" ? "#f59e0b" : "#10b981";
    edges.push({
      id: `edge-${source}-${target}`,
      source,
      target,
      type: "smoothstep",
      animated: target === activeTarget,
      style: { stroke, strokeWidth: 1.5 },
    });
  }

  return edges;
}