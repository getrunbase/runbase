"use client";

import { useState } from "react";
import type { BlockInfo, Definition } from "../../workflows/graph";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

// React Flow loaded on demand (outside the page's First Load JS).
const WorkflowCanvas = dynamic(
  () => import("../../workflows/[id]/canvas").then((m) => m.WorkflowCanvas),
  { ssr: false, loading: () => <Skeleton className="size-full" /> },
);

// Workflow editor canvas, read-only, run path highlighted.
export function RunGraph({
  definition,
  blocks,
  path,
  current,
}: {
  definition: Definition;
  blocks: BlockInfo[];
  path: [string, string | null][];
  current: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(current);
  return (
    <WorkflowCanvas
      definition={definition}
      blocks={blocks}
      selected={selected}
      onSelect={setSelected}
      path={path}
    />
  );
}
