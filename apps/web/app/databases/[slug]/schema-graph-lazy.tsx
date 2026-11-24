"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

export type { SchemaObject } from "./schema-graph";

// React Flow loaded on demand (Schema tab): next/dynamic only splits
// the client bundle from a client component.
export const SchemaGraph = dynamic(
  () => import("./schema-graph").then((m) => m.SchemaGraph),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[70vh] min-h-96 w-full rounded-xl" />,
  },
);
