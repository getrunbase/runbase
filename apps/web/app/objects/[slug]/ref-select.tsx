"use client";

// Linked records selector (ref / refs): Popover + Command, server-side
// search (refOptions) as the user types.
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronsUpDown, X } from "lucide-react";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { refOptions } from "./actions";
import { RefLinks } from "./records-table";

type Link = { id: string; label: string };

export function RefSelect({
  object,
  multiple,
  value,
  onSave,
}: {
  object: string;
  multiple: boolean;
  // Currently linked records (id + label).
  value: Link[];
  onSave: (v: string | string[] | null, links: Link[]) => void;
}) {
  const t = useTranslations("objects.refSelect");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<Link[]>();
  const [selected, setSelected] = useState(value);
  const valueKey = value.map((l) => l.id).join(",");
  // Resyncs when links change on the parent side (after reload).
  const [seen, setSeen] = useState(valueKey);
  if (seen !== valueKey) {
    setSeen(valueKey);
    setSelected(value);
  }

  useEffect(() => {
    if (!open) return;
    let live = true;
    const timer = setTimeout(
      () =>
        refOptions(object, q).then((r) => {
          if (live) setOptions(r.data ?? []);
        }),
      200,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open, q, object]);

  const ids = new Set(selected.map((l) => l.id));
  function toggle(l: Link) {
    if (!multiple) {
      const next = ids.has(l.id) ? [] : [l];
      setSelected(next);
      setOpen(false);
      return onSave(next[0]?.id ?? null, next);
    }
    const next = ids.has(l.id)
      ? selected.filter((x) => x.id !== l.id)
      : [...selected, l];
    setSelected(next);
    onSave(
      next.map((x) => x.id),
      next,
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      <RefLinks object={object} links={selected} />
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setQ("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            aria-label={multiple ? t("editLinks") : t("choose")}
          >
            <ChevronsUpDown className="size-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={t("search")}
              value={q}
              onValueChange={setQ}
            />
            <CommandList>
              <CommandEmpty>
                {options ? t("noResults") : tc("loading")}
              </CommandEmpty>
              {selected.length > 0 && !q && (
                <CommandGroup heading={t("linked")}>
                  {selected.map((l) => (
                    <CommandItem
                      key={l.id}
                      value={`sel-${l.id}`}
                      onSelect={() => toggle(l)}
                    >
                      <span className="truncate">{l.label}</span>
                      <X className="ml-auto size-3.5" />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {options && options.length > 0 && (
                <CommandGroup heading={t("records")}>
                  {options.map((l) => (
                    <CommandItem
                      key={l.id}
                      value={l.id}
                      onSelect={() => toggle(l)}
                    >
                      <span className="truncate">{l.label}</span>
                      {ids.has(l.id) && <Check className="ml-auto size-3.5" />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
