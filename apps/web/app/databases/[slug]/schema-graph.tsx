"use client";

// ERD diagram (React Flow): one node per object, one row per attribute,
// one edge per ref / refs field to the target object. Nodes = shadcn Card.
import { useMemo } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge } from "@getrunbase/ui/components/ui/badge";
import { Card } from "@getrunbase/ui/components/ui/card";
import { cn } from "@/lib/utils";

export type SchemaObject = {
  slug: string;
  name: string;
  external?: string; // database name if the object is outside this one
  fields: { key: string; label: string; type: string; object?: string }[];
};

type Data = { obj: SchemaObject };

function ObjectNode({ data: { obj } }: NodeProps<Node<Data>>) {
  const t = useTranslations("databases");
  return (
    <Card
      className={cn(
        "w-64 gap-0 overflow-hidden py-0 shadow-sm",
        obj.external && "border-dashed opacity-80",
      )}
    >
      <Handle type="target" position={Position.Left} className="!top-5" />
      <div className="bg-muted/60 flex items-center gap-2 border-b px-3 py-2">
        <Link
          href={`/objects/${obj.slug}`}
          className="nodrag flex-1 truncate text-sm font-semibold hover:underline"
        >
          {obj.name}
        </Link>
        {obj.external && (
          <Badge variant="outline" className="text-[10px]">
            {obj.external}
          </Badge>
        )}
      </div>
      {obj.fields.map((f) => {
        const rel = f.type === "ref" || f.type === "refs";
        return (
          <div
            key={f.key}
            className="relative flex items-center gap-2 border-b px-3 py-1.5 text-xs last:border-b-0"
          >
            <span className="flex-1 truncate">{f.label}</span>
            <span
              className={cn(
                "font-mono",
                rel ? "text-primary font-medium" : "text-muted-foreground",
              )}
            >
              {f.type === "refs" ? "refs[]" : f.type}
            </span>
            {rel && (
              <Handle
                id={f.key}
                type="source"
                position={Position.Right}
                className="!bg-primary"
              />
            )}
          </div>
        );
      })}
      {!obj.fields.length && !obj.external && (
        <p className="text-muted-foreground px-3 py-2 text-xs">
          {t("graph.noAttributes")}
        </p>
      )}
    </Card>
  );
}

const nodeTypes = { object: ObjectNode };

export function SchemaGraph({ objects }: { objects: SchemaObject[] }) {
  const { nodes, edges } = useMemo(() => {
    // ponytail: grid placement, auto-layout (dagre/elk) if large schemas get tangled.
    const cols = Math.max(1, Math.ceil(Math.sqrt(objects.length)));
    const nodes: Node<Data>[] = objects.map((obj, i) => ({
      id: obj.slug,
      type: "object",
      position: { x: (i % cols) * 360, y: Math.floor(i / cols) * 320 },
      data: { obj },
    }));
    const ids = new Set(objects.map((o) => o.slug));
    const edges: Edge[] = objects.flatMap((o) =>
      o.fields
        .filter((f) => f.object && ids.has(f.object))
        .map((f) => ({
          id: `${o.slug}.${f.key}`,
          source: o.slug,
          sourceHandle: f.key,
          target: f.object!,
          type: "smoothstep",
          animated: f.type === "refs",
          label: f.type === "refs" ? "1 → n" : "1 → 1",
          labelStyle: { fontSize: 10 },
          markerEnd: { type: MarkerType.ArrowClosed },
        })),
    );
    return { nodes, edges };
  }, [objects]);

  return (
    <div className="bg-card h-[70vh] min-h-96 rounded-xl border">
      <ReactFlow
        defaultNodes={nodes}
        defaultEdges={edges}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
