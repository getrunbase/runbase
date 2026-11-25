"use client";
// MCP reference index: the former single page had one anchor per tool
// (/docs/reference/mcp#recordsupsert). Send these deep links to the tool's
// group page (/docs/reference/mcp/records#recordsupsert).
import { useEffect } from "react";

export function McpAnchorRedirect({ anchors }: { anchors: Record<string, string> }) {
  useEffect(() => {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    const group = anchors[hash];
    if (group)
      window.location.replace(
        `${window.location.pathname.replace(/\/$/, "")}/${group}#${hash}`,
      );
  }, [anchors]);
  return null;
}
