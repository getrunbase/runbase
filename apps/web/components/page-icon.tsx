"use client";

import { LayoutDashboard } from "lucide-react";
import { DynamicIcon, type IconName } from "lucide-react/dynamic";

// Lucide icon of an interface, loaded on demand (kebab-case name).
export function PageIcon({
  name,
  className,
}: {
  name?: string;
  className?: string;
}) {
  return (
    <DynamicIcon
      name={(name || "layout-dashboard") as IconName}
      className={className}
      fallback={() => <LayoutDashboard className={className} />}
    />
  );
}
