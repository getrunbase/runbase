"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

// Monaco loaded on demand (touches window: no SSR).
const Editor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <Skeleton className="h-80 w-full rounded-none" />,
});

// Function code editor: the only allowed use of Monaco.
// The value is copied into a hidden field for server actions.
export function CodeEditor({
  name,
  defaultValue = "",
  language = "typescript",
  height = 320,
}: {
  name: string;
  defaultValue?: string;
  language?: string;
  height?: number;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="overflow-hidden rounded-md border">
      <input type="hidden" name={name} value={value} />
      <Editor
        height={height}
        language={language}
        value={value}
        onChange={(v) => setValue(v ?? "")}
        options={{ minimap: { enabled: false }, fontSize: 12 }}
      />
    </div>
  );
}
