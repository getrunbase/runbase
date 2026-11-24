"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Input } from "@runbase/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Filter = {
  key: string;
  label: string;
  options: { value: string; label: string }[];
};

const ALL = "__all";

// Compact one-line filters, synced with the URL (?key=value).
export function FilterBar({
  filters,
  search,
}: {
  filters: Filter[];
  search?: { key: string; placeholder: string };
}) {
  const t = useTranslations("common");
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const set = (key: string, value: string) => {
    const s = new URLSearchParams(params);
    // New filter: back to the first page.
    s.delete("cursor");
    if (value) s.set(key, value);
    else s.delete(key);
    router.push(`${path}?${s}`);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map((f) => (
        <Select
          key={f.key}
          value={params.get(f.key) || ALL}
          onValueChange={(v) => set(f.key, v === ALL ? "" : v)}
        >
          <SelectTrigger size="sm" className="w-44" aria-label={f.label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>
              {t("allOption", { label: f.label })}
            </SelectItem>
            {f.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
      {search && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            set(
              search.key,
              String(new FormData(e.currentTarget).get("q")).trim(),
            );
          }}
        >
          <Input
            name="q"
            defaultValue={params.get(search.key) ?? ""}
            placeholder={search.placeholder}
            aria-label={search.placeholder}
            className="h-8 w-56"
          />
        </form>
      )}
    </div>
  );
}
