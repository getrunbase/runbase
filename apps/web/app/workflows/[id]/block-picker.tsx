"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Bot,
  BrainCircuit,
  ScanText,
  Wand2,
  ChevronLeft,
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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { IconTile } from "@/components/ds/atoms";
import { toneFg, type Tone } from "@/components/ds/tone";
import { cn } from "cn";
import type { BlockInfo } from "../graph";

// Category + icon per block type. Unknown type: "other".
export type Category =
  "apps" | "ai" | "data" | "lists" | "logic" | "http" | "code" | "other";
const META: Record<string, [Category, LucideIcon]> = {
  "record.get": ["data", FileText],
  "record.search": ["data", FileSearch],
  "record.create": ["data", FilePlus],
  "record.update": ["data", FilePen],
  "record.map": ["data", Copy],
  formatter: ["data", Wand2],
  "list.filter": ["lists", Filter],
  "list.map": ["lists", ListTree],
  loop: ["lists", Repeat],
  condition: ["logic", GitBranch],
  switch: ["logic", Split],
  wait: ["logic", Clock],
  "human.approve": ["logic", CircleCheckBig],
  "ai.decide": ["ai", BrainCircuit],
  "ai.run": ["ai", Bot],
  "ai.extract": ["ai", ScanText],
  "http.request": ["http", Globe],
  "webhook.emit": ["http", Webhook],
  "mcp.call": ["http", Plug],
  "event.emit": ["http", Radio],
};
// Rail and section order.
const ORDER: Category[] = [
  "apps",
  "ai",
  "data",
  "lists",
  "logic",
  "http",
  "code",
  "other",
];

// Colour of each category (theme tokens only).
export const categoryTone: Record<Category, Tone> = {
  apps: "neutral",
  ai: "purple",
  data: "blue",
  lists: "green",
  logic: "orange",
  http: "yellow",
  code: "neutral",
  other: "neutral",
};
// Rail dots: the strong colour of the tone. Literal classes for Tailwind.
const dot: Record<Category, string> = {
  apps: "bg-foreground",
  ai: "bg-tag-purple-fg",
  data: "bg-tag-blue-fg",
  lists: "bg-tag-green-fg",
  logic: "bg-tag-orange-fg",
  http: "bg-tag-yellow-fg",
  code: "bg-muted-foreground",
  other: "bg-muted-foreground",
};

export const metaOf = (type: string): [Category, LucideIcon] =>
  type.startsWith("fn.")
    ? ["code", SquareFunction]
    : type.startsWith("node.")
      ? ["apps", Plug]
      : (META[type] ?? ["other", Shuffle]);

type App = NonNullable<BlockInfo["app"]>;
// App of a connector node; without `app`, the node id prefix.
export const appOf = (b: BlockInfo): App => {
  if (b.app) return b.app;
  const name = b.type.split(".")[1] ?? b.type;
  return { name, label: name };
};

const box = {
  sm: "size-5 rounded-tile",
  md: "size-7 rounded-md",
  lg: "size-9 rounded-lg",
};
const img = { sm: "size-3.5", md: "size-4.5", lg: "size-6" };

// App logo in a bordered tile, otherwise the coloured category icon tile.
export function BlockIcon({
  type,
  logo,
  size = "md",
}: {
  type: string;
  logo?: string;
  size?: keyof typeof box;
}) {
  if (logo)
    return (
      <span
        className={cn(
          "bg-background inline-flex shrink-0 items-center justify-center border",
          box[size],
        )}
      >
        <img src={logo} alt="" className={img[size]} />
      </span>
    );
  const [cat, Icon] = metaOf(type);
  return (
    <IconTile
      icon={Icon}
      tone={categoryTone[cat]}
      className={cn(
        box[size],
        size === "sm" ? "[&_svg]:size-3" : "[&_svg]:size-4",
      )}
    />
  );
}

// Step picker: search, category rail, app tiles (logo, action count),
// compact core blocks, one app's actions once opened.
export function BlockPicker({
  blocks,
  onPick,
}: {
  blocks: BlockInfo[];
  onPick: (type: string) => void;
}) {
  const t = useTranslations("workflows");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Category | "all">("all");
  const [app, setApp] = useState<string | null>(null);

  const live = blocks.filter((b) => !b.deprecated);
  const isApp = (b: BlockInfo) => metaOf(b.type)[0] === "apps";
  const apps = [
    ...new Map(
      live.filter(isApp).map((b) => [appOf(b).name, appOf(b)]),
    ).values(),
  ].sort((a, b) => a.label.localeCompare(b.label));
  const actionsOf = (name: string) =>
    live.filter((b) => isApp(b) && appOf(b).name === name);
  const inCat = (c: Category) => live.filter((b) => metaOf(b.type)[0] === c);
  const count = (c: Category) => (c === "apps" ? apps.length : inCat(c).length);
  const cats = ORDER.filter((c) => count(c) > 0);

  const reset = () => {
    setQ("");
    setApp(null);
    setCat("all");
  };
  const pick = (type: string) => {
    onPick(type);
    setOpen(false);
    reset();
  };
  // Context of a block in search results: its app, otherwise its category.
  const contextOf = (b: BlockInfo) =>
    isApp(b) ? appOf(b).label : t(`blocks.category.${metaOf(b.type)[0]}`);
  const needle = q.trim().toLowerCase();
  const found = needle
    ? live.filter((b) =>
        [b.label, b.type, b.description, contextOf(b)]
          .join(" ")
          .toLowerCase()
          .includes(needle),
      )
    : [];
  const current = app ? apps.find((a) => a.name === app) : undefined;

  // Compact row: icon tile + label (the description is only searched).
  const row = (b: BlockInfo, withContext = false) => (
    <CommandItem
      key={b.type}
      value={b.type}
      onSelect={() => pick(b.type)}
      className="gap-2.5 px-2 py-2"
    >
      <BlockIcon type={b.type} logo={b.app?.logo} />
      <span className="min-w-0 flex-1 truncate text-sm">{b.label}</span>
      {withContext && (
        <span className="text-muted-foreground shrink-0 text-xs">
          {contextOf(b)}
        </span>
      )}
    </CommandItem>
  );

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Plus /> {t("blocks.add")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="flex h-[min(620px,85vh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>{t("blocks.add")}</DialogTitle>
            <DialogDescription>{t("blocks.description")}</DialogDescription>
          </DialogHeader>
          <Command
            shouldFilter={false}
            loop
            className="min-h-0 flex-1"
            onKeyDown={(e) => {
              // Backspace on an empty search: back to the app list.
              if (e.key === "Backspace" && !q && app) setApp(null);
            }}
          >
            <div className="flex items-center border-b pr-3 *:data-[slot=command-input-wrapper]:h-12 *:data-[slot=command-input-wrapper]:flex-1 *:data-[slot=command-input-wrapper]:border-b-0">
              <CommandInput
                value={q}
                onValueChange={setQ}
                placeholder={t("blocks.search")}
                aria-label={t("blocks.search")}
              />
              <Kbd>{t("blocks.escape")}</Kbd>
            </div>
            <div className="flex min-h-0 flex-1">
              {!needle && !current && (
                <nav
                  aria-label={t("blocks.categories")}
                  className="hidden w-46 shrink-0 flex-col gap-0.5 border-r p-2 sm:flex"
                >
                  {(["all", ...cats] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={cat === c}
                      onClick={() => setCat(c)}
                      className={cn(
                        "hover:bg-accent flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                        cat === c && "bg-accent font-medium",
                      )}
                    >
                      {c !== "all" && (
                        <span className={cn("size-2 rounded-xs", dot[c])} />
                      )}
                      <span className="flex-1">
                        {c === "all"
                          ? t("blocks.all")
                          : t(`blocks.category.${c}`)}
                      </span>
                      {c !== "all" && (
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {count(c)}
                        </span>
                      )}
                    </button>
                  ))}
                </nav>
              )}
              <CommandList className="max-h-none min-h-0 flex-1 overflow-y-auto p-3">
                <CommandEmpty>{t("blocks.empty")}</CommandEmpty>
                {needle ? (
                  found.map((b) => row(b, true))
                ) : current ? (
                  <>
                    <div className="flex items-center gap-3 px-1 pb-3">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("blocks.back")}
                        onClick={() => setApp(null)}
                        className="size-7"
                      >
                        <ChevronLeft />
                      </Button>
                      <BlockIcon
                        type={`node.${current.name}`}
                        logo={current.logo}
                        size="lg"
                      />
                      <div className="flex flex-col">
                        <span className="text-base font-semibold">
                          {current.label}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {t("blocks.actionCount", {
                            count: actionsOf(current.name).length,
                          })}
                        </span>
                      </div>
                    </div>
                    {actionsOf(current.name).map((b) => (
                      <CommandItem
                        key={b.type}
                        value={b.type}
                        onSelect={() => pick(b.type)}
                        className="px-2 py-2.5"
                      >
                        <span className="text-sm font-medium">{b.label}</span>
                      </CommandItem>
                    ))}
                  </>
                ) : (
                  (cat === "all" ? cats : [cat]).map((c) => (
                    <CommandGroup
                      key={c}
                      heading={
                        <span
                          className={cn(
                            "text-tiny font-semibold tracking-wide uppercase",
                            c === "apps"
                              ? "text-muted-foreground"
                              : toneFg[categoryTone[c]],
                          )}
                        >
                          {t(`blocks.category.${c}`)}
                        </span>
                      }
                      className="mb-2"
                    >
                      {c === "apps" ? (
                        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
                          {apps.map((a) => (
                            <CommandItem
                              key={a.name}
                              value={`app:${a.name}`}
                              onSelect={() => setApp(a.name)}
                              className="flex-col gap-2 rounded-lg border px-1.5 py-3.5 text-center"
                            >
                              <BlockIcon
                                type={`node.${a.name}`}
                                logo={a.logo}
                                size="lg"
                              />
                              <span className="w-full truncate text-sm font-medium">
                                {a.label}
                              </span>
                              <span className="text-muted-foreground text-tiny">
                                {t("blocks.actionCount", {
                                  count: actionsOf(a.name).length,
                                })}
                              </span>
                            </CommandItem>
                          ))}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
                          {inCat(c).map((b) => row(b))}
                        </div>
                      )}
                    </CommandGroup>
                  ))
                )}
              </CommandList>
            </div>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
