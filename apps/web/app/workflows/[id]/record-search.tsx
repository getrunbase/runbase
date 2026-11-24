"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Search, X } from "lucide-react";
import { Badge } from "@getrunbase/ui/components/ui/badge";
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
import { refOptions } from "../../objects/[slug]/actions";

export type Link = { id: string; label: string };

// Test records: server-side search on the workflow object.
export function RecordSearch({
  object,
  value,
  onChange,
}: {
  object?: string;
  value: Link[];
  onChange: (v: Link[]) => void;
}) {
  const t = useTranslations("workflows");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<Link[]>();
  useEffect(() => {
    if (!open || !object) return;
    let live = true;
    const timer = setTimeout(
      () => refOptions(object, q).then((r) => live && setOptions(r.data ?? [])),
      200,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open, q, object]);
  const ids = new Set(value.map((l) => l.id));
  return (
    <div className="flex items-center gap-1">
      {value.map((l) => (
        <Badge key={l.id} variant="secondary">
          {l.label}
          <button
            type="button"
            aria-label={t("editor.removeItem", { label: l.label })}
            onClick={() => onChange(value.filter((x) => x.id !== l.id))}
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" disabled={!object}>
            <Search />{" "}
            {value.length
              ? t("editor.testRecords.selected")
              : t("editor.testRecords.button")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="end">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={t("editor.testRecords.search")}
              value={q}
              onValueChange={setQ}
            />
            <CommandList>
              <CommandEmpty>
                {options ? t("editor.testRecords.empty") : tc("loading")}
              </CommandEmpty>
              {options && options.length > 0 && (
                <CommandGroup heading={t("editor.testRecords.selected")}>
                  {options.map((l) => (
                    <CommandItem
                      key={l.id}
                      value={l.id}
                      onSelect={() =>
                        onChange(
                          ids.has(l.id)
                            ? value.filter((x) => x.id !== l.id)
                            : [...value, l],
                        )
                      }
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
