"use client";

// Only module allowed to import React Flow (graph lib): the nodes
// are the base FlowNode (components/ds/flow), styled with tokens.
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  applyNodeChanges,
  Handle,
  Panel,
  Position,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { LucideIcon } from "lucide-react";
import type { Tone } from "@/components/ds/tone";
import {
  CanvasControls,
  FlowNode,
  Minimap,
  type FlowNodeKind,
} from "@/components/ds/flow";
import {
  branchesOf,
  branchName,
  entryOf,
  positions,
  targetsAt,
  unlinked,
  type BlockInfo,
  type Definition,
} from "../graph";
import { makeLabels, type WorkflowsT } from "../labels";
import { kindOf } from "./kind";

type Data = {
  label: string;
  type: string;
  kind: FlowNodeKind;
  kindLabel: string;
  icon?: LucideIcon;
  tone?: Tone;
  logo?: string;
  branches: { id: string; label: string }[];
  // No incoming link (trigger included).
  unlinked?: boolean;
  unlinkedLabel?: string;
  trigger?: boolean;
  selected?: boolean;
};

// Invisible React Flow handle, placed on the handle drawn by FlowNode.
const handle = "!size-2.5 !min-h-0 !min-w-0 !border-0 !bg-transparent";

// Canvas node: base FlowNode (Fj8lH board); the React
// Flow handles match the outputs (same invisible label = same centre).
function StepNode({ data }: NodeProps<Node<Data>>) {
  const outs = data.trigger
    ? [{ id: "start", label: "" }]
    : data.branches.length
      ? data.branches
      : [];
  return (
    <div className="relative">
      <FlowNode
        kind={data.kind}
        kindLabel={data.kindLabel}
        icon={data.icon}
        tone={data.tone}
        logo={data.logo}
        title={data.label}
        description={data.type || undefined}
        state={
          data.selected ? "selected" : data.unlinked ? "unlinked" : "default"
        }
        status={data.unlinked ? data.unlinkedLabel : undefined}
        branches={data.trigger ? undefined : data.branches.map((b) => b.label)}
        hasInput={!data.trigger}
      />
      {!data.trigger && (
        <Handle type="target" position={Position.Top} className={handle} />
      )}
      <div className="absolute inset-x-3 bottom-0 flex justify-around">
        {outs.map((b) => (
          <div key={b.id} className="flex flex-col items-center gap-1.5">
            {b.label && (
              <span className="invisible rounded-sm border px-1.5 py-px text-micro font-medium">
                {b.label}
              </span>
            )}
            <span className="relative h-1.25 w-2.5">
              <Handle
                id={b.id}
                type="source"
                position={Position.Bottom}
                className={handle}
              />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Base controls and minimap, wired to React Flow.
function Overlay({ nodes, t }: { nodes: Node<Data>[]; t: WorkflowsT }) {
  const rf = useReactFlow();
  // Initial board view: zoom 1, graph centred horizontally, first
  // node 24px from the top.
  const ready = useNodesInitialized();
  const placed = useRef(false);
  useEffect(() => {
    if (!ready || placed.current) return;
    placed.current = true;
    void rf.fitView({ minZoom: 1, maxZoom: 1 }).then(() => {
      const top = rf.getNodesBounds(rf.getNodes()).y;
      rf.setViewport({ ...rf.getViewport(), y: 24 - top });
    });
  }, [ready, rf]);
  const [locked, setLocked] = useState(false);
  // 180×120 minimap: positions scaled into the frame (24×12 node).
  const xs = nodes.map((n) => n.position.x);
  const ys = nodes.map((n) => n.position.y);
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)];
  const w = Math.max(...xs) - x0 || 1;
  const h = Math.max(...ys) - y0 || 1;
  const k = Math.min(140 / w, 96 / h, 0.25);
  const ox = (180 - 24 - w * k) / 2;
  const oy = (120 - 12 - h * k) / 2;
  return (
    <>
      <Panel position="bottom-left" className="!m-4">
        <CanvasControls
          labels={{
            zoomIn: t("canvas.a11y.zoomIn"),
            zoomOut: t("canvas.a11y.zoomOut"),
            fit: t("canvas.a11y.fitView"),
            lock: t("canvas.a11y.interactive"),
          }}
          onZoomIn={() => rf.zoomIn()}
          onZoomOut={() => rf.zoomOut()}
          onFit={() => rf.fitView({ maxZoom: 1 })}
          onLock={() => {
            const next = !locked;
            setLocked(next);
            rf.setNodes((ns) => ns.map((n) => ({ ...n, draggable: !next })));
          }}
        />
      </Panel>
      <Panel position="bottom-right" className="!m-4">
        <Minimap
          nodes={nodes.map((n) => ({
            x: ox + (n.position.x - x0) * k,
            y: oy + (n.position.y - y0) * k,
          }))}
        />
      </Panel>
    </>
  );
}

const nodeTypes = { step: StepNode };

// React Flow accessibility labels, translated.
const ariaConfig = (t: WorkflowsT) => ({
  "node.a11yDescription.default": t("canvas.a11y.nodeDefault"),
  "node.a11yDescription.keyboardDisabled": t(
    "canvas.a11y.nodeKeyboardDisabled",
  ),
  "node.a11yDescription.ariaLiveMessage": ({
    direction,
    x,
    y,
  }: {
    direction: string;
    x: number;
    y: number;
  }) => t("canvas.a11y.nodeMoved", { direction, x, y }),
  "edge.a11yDescription.default": t("canvas.a11y.edgeDefault"),
  "controls.ariaLabel": t("canvas.a11y.controls"),
  "controls.zoomIn.ariaLabel": t("canvas.a11y.zoomIn"),
  "controls.zoomOut.ariaLabel": t("canvas.a11y.zoomOut"),
  "controls.fitView.ariaLabel": t("canvas.a11y.fitView"),
  "controls.interactive.ariaLabel": t("canvas.a11y.interactive"),
  "minimap.ariaLabel": t("canvas.a11y.minimap"),
  "handle.ariaLabel": t("canvas.a11y.handle"),
});

export function WorkflowCanvas({
  definition,
  blocks,
  selected,
  onSelect,
  onConnect,
  onDisconnect,
  onAddEntry,
  onRemoveEntry,
  onMove,
  path,
}: {
  definition: Definition;
  blocks: BlockInfo[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  // Absent: read-only canvas (run detail).
  onConnect?: (source: string, branch: string, target: string) => void;
  // Delete on a link: removes only this target.
  onDisconnect?: (source: string, branch: string, target: string) => void;
  // Link drawn from the trigger: the target step becomes an entry;
  // deleting this link removes it from the entries.
  onAddEntry?: (target: string) => void;
  onRemoveEntry?: (target: string) => void;
  // End of a node drag: position saved in the definition.
  onMove?: (id: string, pos: { x: number; y: number }) => void;
  // Path taken by a run: [stepId, branch] in order.
  path?: [string, string | null][];
}) {
  const t = useTranslations("workflows");
  const l = makeLabels(t);
  const readOnly = !onConnect;
  const visited = new Set(path?.map(([id]) => id));
  const taken = new Set(path?.map(([id, b]) => `${id}:${b}`));
  // Saved positions (definition.layout), otherwise automatic.
  const auto = useMemo(() => positions(definition), [definition]);
  const pos = (id: string) => auto[id] ?? { x: 0, y: 0 };
  const entry = entryOf(definition);
  const loose = new Set(readOnly ? [] : unlinked(definition));

  const computed: Node<Data>[] = [
    {
      id: "trigger",
      type: "step",
      position: pos("trigger"),
      data: {
        label: l.trigger(String(definition.trigger.type ?? "?")),
        type: "",
        kind: "trigger" as const,
        kindLabel: t("canvas.trigger"),
        branches: [],
        trigger: true,
        selected: selected === "trigger",
      },
    },
    ...definition.steps.map((s) => {
      const block = blocks.find((b) => b.type === s.type);
      return {
        id: s.id,
        type: "step",
        position: pos(s.id),
        data: {
          label: block?.label ?? s.type,
          type: "",
          ...kindOf(s.type, t, block),
          unlinkedLabel: t("canvas.unlinked"),
          branches: branchesOf(s, block).map((b) => ({
            id: b,
            label: branchName(s, b, l.branch),
          })),
          unlinked: loose.has(s.id),
          selected: selected === s.id || visited.has(s.id),
        },
        deletable: false,
      };
    }),
  ];

  // Controlled nodes: we keep the React Flow state (position, measures) between
  // two renders, otherwise each render re-measures every node (flash effect).
  const [nodes, setNodes] = useState<Node<Data>[]>(computed);
  // Position follows the auto layout (nodes not moved by hand).
  const key = JSON.stringify(computed.map((n) => [n.id, n.data, n.position]));
  useEffect(() => {
    setNodes((prev) =>
      computed.map((n) => {
        const old = prev.find((p) => p.id === n.id);
        return old ? { ...old, data: n.data, position: n.position } : n;
      }),
    );
  }, [key]);
  // One link per target: the id includes the target (Delete removes only that one).
  const edges: Edge[] = [
    ...entry.map((target) => ({
      id: `trigger:${target}`,
      source: "trigger",
      sourceHandle: "start",
      target,
      ariaLabel: t("canvas.triggerEdge", { target }),
      animated: visited.has(target),
    })),
    ...Object.entries(definition.next ?? {}).flatMap(([source, out]) =>
      Object.keys(out).flatMap((branch) =>
        targetsAt(definition, source, branch).map((target) => ({
          id: `${source}:${branch}:${target}`,
          source,
          sourceHandle: branch,
          target,
          ariaLabel: t("canvas.edge", {
            branch: branchName(
              definition.steps.find((s) => s.id === source),
              branch,
              l.branch,
            ),
            source,
            target,
          }),
          animated: taken.has(`${source}:${branch}`) && visited.has(target),
        })),
      ),
    ),
  ];

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, n) => onSelect(n.id)}
      onPaneClick={() => onSelect(null)}
      onNodesChange={(changes) =>
        setNodes((ns) => applyNodeChanges(changes, ns))
      }
      onNodeDragStop={(_, n) => onMove?.(n.id, n.position)}
      nodesConnectable={!readOnly}
      onConnect={(c) => {
        if (c.source === "trigger") onAddEntry?.(c.target);
        else if (c.sourceHandle)
          onConnect?.(c.source, c.sourceHandle, c.target);
      }}
      // Link selected on click, deleted with Delete or Backspace.
      onEdgesDelete={(es) =>
        es.forEach((e) =>
          e.source === "trigger"
            ? onRemoveEntry?.(e.target)
            : e.sourceHandle &&
              onDisconnect?.(e.source, e.sourceHandle, e.target),
        )
      }
      deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
      ariaLabelConfig={ariaConfig(t)}
      // Board edges: 1.5px edge stroke, no label (it is on the node).
      defaultEdgeOptions={{
        style: { stroke: "var(--color-edge)", strokeWidth: 1.5 },
      }}
      proOptions={{ hideAttribution: true }}
      className="bg-secondary"
    >
      <Overlay nodes={nodes} t={t} />
    </ReactFlow>
  );
}
