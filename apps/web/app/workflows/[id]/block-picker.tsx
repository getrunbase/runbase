"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Bot,
  BrainCircuit,
  ScanText,
  Wand2,
  CircleCheckBig,
  Clock,
  Copy,
  FilePen,
  FilePlus,
  FileSearch,
  FileText,
  Filter,
  GitBranch,
  Globe,
  MessageSquare,
  ListTree,
  Plug,
  Plus,
  Radio,
  Repeat,
  Shuffle,
  Split,
  SquareFunction,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@getrunbase/ui/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { BlockInfo } from "../graph";

// Category + icon per block type. Unknown type: "other".
export type Category =
  "data" | "logic" | "ai" | "communication" | "connectors" | "code" | "other";
const META: Record<string, [Category, LucideIcon]> = {
  "record.get": ["data", FileText],
  "record.search": ["data", FileSearch],
  "record.create": ["data", FilePlus],
  "record.update": ["data", FilePen],
  "record.map": ["data", Copy],
  "list.filter": ["data", Filter],
  "list.map": ["data", ListTree],
  formatter: ["data", Wand2],
  condition: ["logic", GitBranch],
  switch: ["logic", Split],
  loop: ["logic", Repeat],
  wait: ["logic", Clock],
  "human.approve": ["logic", CircleCheckBig],
  "ai.decide": ["ai", BrainCircuit],
  "ai.run": ["ai", Bot],
  "ai.extract": ["ai", ScanText],
  "http.request": ["connectors", Globe],
  "webhook.emit": ["connectors", Webhook],
  "mcp.call": ["connectors", Plug],
  "event.emit": ["connectors", Radio],
  "slack.send": ["communication", MessageSquare],
};
const ORDER: Category[] = [
  "data",
  "logic",
  "ai",
  "communication",
  "connectors",
  "code",
  "other",
];

export const metaOf = (type: string): [Category, LucideIcon] =>
  type.startsWith("fn.")
    ? ["code", SquareFunction]
    : type.startsWith("node.")
      ? ["connectors", Plug]
      : (META[type] ?? ["other", Shuffle]);

// Block picker (⌘K-like): search, categories, icons, descriptions.
export function BlockPicker({
  blocks,
  onPick,
}: {
  blocks: BlockInfo[];
  onPick: (type: string) => void;
}) {
  const t = useTranslations("workflows");
  const [open, setOpen] = useState(false);
  const groups = ORDER.map((g) => ({
    name: g,
    items: blocks.filter((b) => metaOf(b.type)[0] === g),
  })).filter((g) => g.items.length);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Plus /> {t("blocks.add")}
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title={t("blocks.add")}
        description={t("blocks.description")}
        className="sm:max-w-xl"
      >
        <CommandInput placeholder={t("blocks.search")} />
        <CommandList className="max-h-[60vh]">
          <CommandEmpty>{t("blocks.empty")}</CommandEmpty>
          {groups.map((g) => (
            <CommandGroup key={g.name} heading={t(`blocks.category.${g.name}`)}>
              {g.items.map((b) => {
                const Icon = metaOf(b.type)[1];
                return (
                  <CommandItem
                    key={b.type}
                    value={`${b.label} ${b.type} ${b.description}`}
                    onSelect={() => {
                      onPick(b.type);
                      setOpen(false);
                    }}
                    className="items-start gap-3 py-2"
                  >
                    <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-md">
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{b.label}</p>
                      <p className="text-muted-foreground line-clamp-2 text-xs">
                        {b.description}
                      </p>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}
