/** @jsxRuntime automatic */
// Data-bound inputs: FilterBar (search + select fields of
// the object), FileDrop (useUpload), CommandPalette (cmdk via @ui/command).
import { useRef, useState } from "react";
import type { FileValue, Filter, Row } from "@runbase/sdk";
import { Button } from "@ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@ui/command";
import { Input } from "@ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ui/select";
import { sdk } from "./sdk";
import { BlockState, labelsOf, type Labels } from "./state";
import { titleOf } from "./table";
import { useFields } from "./views";

export type FilterValue = { q?: string; filter?: Filter };

// `{all: [...]}` filter from the chosen values (field -> value).
export const filterOf = (picked: Record<string, string>): Filter | undefined => {
  const all = Object.entries(picked)
    .filter(([, v]) => v)
    .map(([field, value]) => ({ field, op: "eq", value }));
  return all.length ? { all } : undefined;
};

export type FilterBarProps = {
  object: string;
  // Offered select fields (default: all select fields of the object).
  fields?: string[];
  onChange: (v: FilterValue) => void;
  labels?: Labels;
};

// Filter bar: pass it to DataTable/Gallery/Kanban (`filter`, `q`).
export function FilterBar({ object, fields, onChange, labels }: FilterBarProps) {
  const l = labelsOf(labels);
  const schema = useFields(object);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const selects = schema.fields.filter(
    (f) => f.type === "select" && (!fields || fields.includes(f.key)),
  );
  const emit = (nq: string, np: Record<string, string>) => {
    setQ(nq);
    setPicked(np);
    onChange({ ...(nq.trim() && { q: nq.trim() }), filter: filterOf(np) });
  };
  return (
    <BlockState loading={schema.loading} error={schema.error} labels={labels}>
      <div className="flex flex-wrap items-center gap-2" data-kit="filter-bar">
        <Input value={q} onChange={(e) => emit(e.target.value, picked)} placeholder={l.search} className="w-56" />
        {selects.map((f) => (
          <Select
            key={f.key}
            value={picked[f.key] || "*"}
            onValueChange={(v) => emit(q, { ...picked, [f.key]: v === "*" ? "" : v })}
          >
            <SelectTrigger className="w-44" aria-label={f.label ?? f.key}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="*">
                {f.label ?? f.key}: {l.all}
              </SelectItem>
              {(f.options ?? []).map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
        {(q || Object.values(picked).some(Boolean)) && (
          <Button variant="ghost" size="sm" onClick={() => emit("", {})}>
            {l.clear}
          </Button>
        )}
      </div>
    </BlockState>
  );
}

export type FileDropProps = {
  // Called with the uploaded `file` values (to write into a file field).
  onUploaded: (files: FileValue[]) => void;
  accept?: string;
  multiple?: boolean;
  labels?: Labels;
};

// File drop: drag and drop or click, uploaded by useUpload.
export function FileDrop({ onUploaded, accept, multiple = true, labels }: FileDropProps) {
  const l = labelsOf(labels);
  const { upload, pending, error } = sdk().useUpload();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const send = async (list: FileList | null) => {
    const out: FileValue[] = [];
    for (const f of Array.from(list ?? [])) {
      const r = await upload(f);
      if (r.ok) out.push(r.data);
    }
    if (out.length) onUploaded(out);
  };
  return (
    <div className="flex flex-col gap-2" data-kit="file-drop">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void send(e.dataTransfer.files);
        }}
        className={`flex min-h-28 items-center justify-center rounded-lg border-2 border-dashed p-4 text-sm text-muted-foreground ${over ? "border-primary bg-primary/5" : ""}`}
      >
        {pending ? l.uploading : l.drop}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        onChange={(e) => void send(e.target.files)}
      />
      {error && <BlockState error={error} labels={labels}>{null}</BlockState>}
    </div>
  );
}

export type PaletteCommand = { id: string; label: string; group?: string; run: () => void };

export type CommandPaletteProps = {
  // Fixed commands (navigation, actions).
  commands?: PaletteCommand[];
  // Search records of this object (title = `titleField`).
  object?: string;
  titleField?: string;
  onSelectRecord?: (row: Row) => void;
  // Controlled: palette in a dialog; absent: palette embedded in the page.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  labels?: Labels;
};

export function CommandPalette({
  commands = [],
  object,
  titleField,
  onSelectRecord,
  open,
  onOpenChange,
  labels,
}: CommandPaletteProps) {
  const l = labelsOf(labels);
  const [q, setQ] = useState("");
  const res = sdk().useQuery({
    object: object ?? "",
    limit: 20,
    ...(q.trim() && { q: q.trim() }),
    enabled: !!object && open !== false,
  });
  const groups = [...new Set(commands.map((c) => c.group ?? ""))];
  const body = (
    <>
      <CommandInput value={q} onValueChange={setQ} placeholder={l.command} />
      <CommandList>
        <CommandEmpty>{res.loading ? l.loading : l.noResults}</CommandEmpty>
        {groups.map((g) => (
          <CommandGroup key={g} heading={g || undefined}>
            {commands
              .filter((c) => (c.group ?? "") === g)
              .map((c) => (
                <CommandItem key={c.id} value={c.label} onSelect={c.run}>
                  {c.label}
                </CommandItem>
              ))}
          </CommandGroup>
        ))}
        {object && res.data.length > 0 && (
          <CommandGroup heading={object}>
            {res.data.map((r) => (
              <CommandItem key={r.id} value={`${titleOf(r, titleField)} ${r.id}`} onSelect={() => onSelectRecord?.(r)}>
                {titleOf(r, titleField)}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </>
  );
  if (open === undefined)
    return (
      <Command shouldFilter={!object} className="rounded-lg border" data-kit="command-palette">
        {body}
      </Command>
    );
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title={l.command} description={l.command}>
      {body}
    </CommandDialog>
  );
}
