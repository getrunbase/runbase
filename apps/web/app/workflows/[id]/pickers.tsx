"use client";

// Editor selectors: database → object, field of an
// object (relations expanded), variable menu and pill input. All built with
// Popover + Command: no submenus that close on hover, and the menu
// closes after selection.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  Workflow,
} from "lucide-react";
import type { Field } from "@getrunbase/core/objects/fields";
import { badgeVariants } from "@getrunbase/ui/components/ui/badge";
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
import { cn } from "@/lib/utils";
import { fieldAt, type ObjectInfo } from "../graph";
import { makeLabels, type WorkflowsT } from "../labels";
import {
  parseTemplate,
  rootName,
  toTemplate,
  varField,
  varLabel,
  type Segment,
  type VarScope,
} from "../variables";

const databasesOf = (objects: ObjectInfo[]) => [
  ...new Map(objects.map((o) => [o.database.slug, o.database])).values(),
];

export { FIELD_ICONS } from "@/lib/field-icons";
import { FIELD_ICONS } from "@/lib/field-icons";

export function ObjectPicker({
  value,
  objects,
  onChange,
}: {
  value?: string;
  objects: ObjectInfo[];
  onChange: (slug: string) => void;
}) {
  const t = useTranslations("workflows");
  const [open, setOpen] = useState(false);
  const current = objects.find((o) => o.slug === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-between">
          <span className="truncate">
            {current
              ? `${current.database.name} › ${current.name}`
              : t("pickers.chooseObject")}
          </span>
          <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={t("pickers.searchObject")} />
          <CommandList>
            <CommandEmpty>{t("pickers.noObject")}</CommandEmpty>
            {databasesOf(objects).map((db) => (
              <CommandGroup key={db.slug} heading={db.name}>
                {objects
                  .filter((o) => o.database.slug === db.slug)
                  .map((o) => (
                    <CommandItem
                      key={o.slug}
                      value={`${db.name} ${o.name}`}
                      onSelect={() => {
                        onChange(o.slug);
                        setOpen(false);
                      }}
                    >
                      {o.name}
                    </CommandItem>
                  ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Menu root: triggering record, source record, step record, or
// object of a condition (empty prefix).
type Root = {
  heading: string;
  object?: string;
  prefix: string;
  // Path of the record itself (e.g. `record.id`) and its label.
  self?: { path: string; label: string };
  // Non-record outputs of a step (reason, branch…).
  leaves?: { path: string; label: string }[];
};
type Level = { object: string; prefix: string; label: string; hops: number };

const isRel = (f: Field) => f.type === "ref" || f.type === "refs";
const MAX_HOPS = 3;

// All entries flattened (search): path, labels, field.
function flatten(
  objects: ObjectInfo[],
  object: string | undefined,
  prefix: string,
  labels: string[],
  hops: number,
  records: boolean,
): { path: string; label: string; field: Field }[] {
  const o = objects.find((x) => x.slug === object);
  return (o?.fields ?? []).flatMap((f) => {
    const l = [...labels, f.label];
    const here =
      !records || isRel(f)
        ? [{ path: prefix + f.key, label: l.join(" › "), field: f }]
        : [];
    return isRel(f) && hops < MAX_HOPS
      ? [
          ...here,
          ...flatten(
            objects,
            (f as { object: string }).object,
            `${prefix}${f.key}.`,
            l,
            hops + 1,
            records,
          ),
        ]
      : here;
  });
}

function FieldIcon({ field }: { field?: Field }) {
  const Icon = field ? FIELD_ICONS[field.type] : Workflow;
  return <Icon className="text-muted-foreground" />;
}

// Command list of variables / fields, with relations expandable over
// 3 levels. `records`: records only ("Record" field).
function VariableList({
  roots,
  objects,
  records,
  onPick,
}: {
  roots: Root[];
  objects: ObjectInfo[];
  records?: boolean;
  onPick: (path: string) => void;
}) {
  const t = useTranslations("workflows");
  const tc = useTranslations("common");
  const l = makeLabels(t);
  const [q, setQ] = useState("");
  const [stack, setStack] = useState<Level[]>([]);
  const level = stack.at(-1);
  const fieldsOf = (slug?: string) =>
    objects.find((o) => o.slug === slug)?.fields ?? [];
  const item = (f: Field, prefix: string, hops: number) => {
    const target = isRel(f) && (f as { object: string }).object;
    const drill = target && hops < MAX_HOPS;
    if (records && !target) return null;
    return (
      <CommandItem
        key={prefix + f.key}
        value={prefix + f.key}
        onSelect={() =>
          drill
            ? setStack([
                ...stack,
                {
                  object: target,
                  prefix: `${prefix}${f.key}.`,
                  label: f.label,
                  hops: hops + 1,
                },
              ])
            : onPick(prefix + f.key)
        }
      >
        <FieldIcon field={f} />
        {f.label}
        <span className="text-muted-foreground ml-auto text-xs">
          {drill ? <ChevronRight /> : l.fieldType(f.type)}
        </span>
      </CommandItem>
    );
  };
  return (
    <Command>
      <CommandInput
        placeholder={t("pickers.searchField")}
        value={q}
        onValueChange={setQ}
      />
      <CommandList>
        <CommandEmpty>{t("pickers.noField")}</CommandEmpty>
        {q ? (
          roots.map((r) => (
            <CommandGroup key={r.heading} heading={r.heading}>
              {r.self && (
                <CommandItem
                  value={`${r.heading} ${r.self.label}`}
                  onSelect={() => onPick(r.self!.path)}
                >
                  <Workflow className="text-muted-foreground" />
                  {r.self.label}
                </CommandItem>
              )}
              {!records &&
                r.leaves?.map((l) => (
                  <CommandItem
                    key={l.path}
                    value={`${r.heading} ${l.label}`}
                    onSelect={() => onPick(l.path)}
                  >
                    <Workflow className="text-muted-foreground" />
                    {l.label}
                  </CommandItem>
                ))}
              {flatten(objects, r.object, r.prefix, [], 0, !!records).map(
                (e) => (
                  <CommandItem
                    key={e.path}
                    value={`${r.heading} ${e.label}`}
                    onSelect={() => onPick(e.path)}
                  >
                    <FieldIcon field={e.field} />
                    {e.label}
                  </CommandItem>
                ),
              )}
            </CommandGroup>
          ))
        ) : level ? (
          <CommandGroup heading={stack.map((l) => l.label).join(" › ")}>
            <CommandItem
              value="__back"
              onSelect={() => setStack(stack.slice(0, -1))}
            >
              <ChevronLeft className="text-muted-foreground" />
              {tc("back")}
            </CommandItem>
            <CommandItem
              value="__self"
              onSelect={() => onPick(level.prefix.slice(0, -1))}
            >
              <ArrowUpRight className="text-muted-foreground" />
              {t("pickers.theRecord", { label: level.label })}
            </CommandItem>
            {fieldsOf(level.object).map((f) =>
              item(f, level.prefix, level.hops),
            )}
          </CommandGroup>
        ) : (
          roots.map((r) => (
            <CommandGroup key={r.heading} heading={r.heading}>
              {r.self && (
                <CommandItem
                  value={`${r.heading}__self`}
                  onSelect={() => onPick(r.self!.path)}
                >
                  <Workflow className="text-muted-foreground" />
                  {r.self.label}
                </CommandItem>
              )}
              {!records &&
                r.leaves?.map((l) => (
                  <CommandItem
                    key={l.path}
                    value={l.path}
                    onSelect={() => onPick(l.path)}
                  >
                    <Workflow className="text-muted-foreground" />
                    {l.label}
                  </CommandItem>
                ))}
              {fieldsOf(r.object).map((f) => item(f, r.prefix, 0))}
            </CommandGroup>
          ))
        )}
      </CommandList>
    </Command>
  );
}

// Variable menu roots for a scope.
function rootsOf(scope: VarScope, t: WorkflowsT): Root[] {
  const name = (slug?: string) =>
    scope.objects.find((o) => o.slug === slug)?.name;
  const roots: Root[] = [];
  if (scope.root)
    roots.push({
      heading: rootName(scope),
      object: scope.root,
      prefix: "record.",
      self: { path: "record.id", label: rootName(scope) },
    });
  if (scope.source)
    roots.push({
      heading: t("pickers.sourceHeading", {
        name: name(scope.source) ?? scope.source,
      }),
      object: scope.source,
      prefix: "source.",
    });
  for (const s of scope.steps) {
    const rec = s.outputs.find((o) => o.object);
    roots.push({
      heading: scope.words.step(s.label),
      object: rec?.object,
      prefix: rec ? `steps.${s.id}.output.${rec.key}.` : "",
      ...(rec && {
        self: {
          path: `steps.${s.id}.output.${rec.key}.id`,
          label: `${rec.label} (${name(rec.object)})`,
        },
      }),
      leaves: s.outputs
        .filter((o) => !o.object)
        .map((o) => ({
          path: `steps.${s.id}.output.${o.key}`,
          label: o.label,
        })),
    });
  }
  return roots;
}

// "+ Variable" button and its menu.
export function VariableMenu({
  scope,
  onPick,
  records,
  open,
  onOpenChange,
}: {
  scope: VarScope;
  onPick: (path: string) => void;
  records?: boolean;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  const t = useTranslations("workflows");
  const [own, setOwn] = useState(false);
  const isOpen = open ?? own;
  const setOpen = onOpenChange ?? setOwn;
  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-xs"
        >
          <Plus /> {t("pickers.variable")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        {isOpen && (
          <VariableList
            roots={rootsOf(scope, t)}
            objects={scope.objects}
            records={records}
            onPick={(p) => {
              onPick(p);
              setOpen(false);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

const PILL = cn(
  badgeVariants({ variant: "secondary" }),
  "mx-0.5 cursor-default select-none align-baseline",
);

function pillNode(
  path: string,
  scope: VarScope,
  typeLabel: (f?: Field) => string,
) {
  const span = document.createElement("span");
  span.contentEditable = "false";
  span.dataset.path = path;
  span.className = PILL;
  span.textContent = varLabel(path, scope);
  const f = varField(path, scope);
  span.title = typeLabel(f);
  return span;
}

// Field DOM -> segments (pills = variables, the rest = text).
function serialize(el: HTMLElement): string {
  const segs: Segment[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE)
      segs.push({ text: (n.textContent ?? "").replace(/\u200b/g, "") });
    else if (n instanceof HTMLElement && n.dataset.path)
      segs.push({ path: n.dataset.path });
    else if (n instanceof HTMLBRElement) segs.push({ text: "\n" });
    else n.childNodes.forEach(walk);
  };
  el.childNodes.forEach(walk);
  return toTemplate(segs);
}

// Pill input: free text and variables (non-editable badges).
// "+ Variable" or `/` opens the menu. Storage: `{{…}}` template.
export function PillInput({
  value,
  onChange,
  scope,
  records,
  single,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  scope: VarScope;
  // Records only ("Record" field).
  records?: boolean;
  // Single variable: choosing it replaces the content.
  single?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const t = useTranslations("workflows");
  const fieldType = makeLabels(t).fieldType;
  const typeLabel = (f?: Field) =>
    f ? fieldType(f.type) : t("pickers.variableTitle");
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<string | null>(null);
  const range = useRef<Range | null>(null);
  const [menu, setMenu] = useState(false);
  // Pill labels: redraws the field when the scope changes.
  const labels = JSON.stringify(
    parseTemplate(value).flatMap((s) =>
      "path" in s ? [varLabel(s.path, scope)] : [],
    ),
  );

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || (value === last.current && el.dataset.labels === labels)) return;
    el.replaceChildren(
      ...parseTemplate(value).map((s) =>
        "path" in s
          ? pillNode(s.path, scope, typeLabel)
          : document.createTextNode(s.text),
      ),
    );
    el.dataset.labels = labels;
    last.current = value;
  }, [value, labels, scope]);

  // Remembers the caret to insert the variable at the right place.
  const saveRange = () => {
    const sel = document.getSelection();
    if (sel?.rangeCount && ref.current?.contains(sel.anchorNode))
      range.current = sel.getRangeAt(0).cloneRange();
  };
  useEffect(() => {
    document.addEventListener("selectionchange", saveRange);
    return () => document.removeEventListener("selectionchange", saveRange);
  }, []);

  const emit = () => {
    const v = serialize(ref.current!);
    last.current = v;
    onChange(v);
  };
  const insert = (path: string) => {
    const el = ref.current!;
    const pill = pillNode(path, scope, typeLabel);
    if (single) el.replaceChildren(pill);
    else {
      const r = range.current;
      if (r && el.contains(r.startContainer)) {
        r.deleteContents();
        r.insertNode(pill);
      } else el.append(pill);
      const after = document.createTextNode(" ");
      pill.after(after);
      const sel = document.getSelection();
      const caret = document.createRange();
      caret.setStart(after, 1);
      sel?.removeAllRanges();
      sel?.addRange(caret);
      range.current = caret;
    }
    emit();
  };

  return (
    <div className="space-y-1">
      <div className="flex min-w-0 items-start gap-1">
        <div
          ref={ref}
          role="textbox"
          aria-label={ariaLabel}
          aria-multiline={!single}
          contentEditable
          suppressContentEditableWarning
          data-placeholder={placeholder ?? t("pickers.pillPlaceholder")}
          className={cn(
            "border-input focus-visible:border-ring focus-visible:ring-ring/50 min-h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1.5 text-sm leading-6 break-words whitespace-pre-wrap shadow-xs outline-none focus-visible:ring-[3px]",
            "empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]",
          )}
          onInput={() => {
            saveRange();
            emit();
          }}
          onBlur={saveRange}
          onKeyDown={(e) => {
            if (e.key === "/") {
              e.preventDefault();
              saveRange();
              setMenu(true);
            } else if (e.key === "Enter" && single) e.preventDefault();
          }}
          onPaste={(e) => {
            // Plain text only (no pasted HTML).
            e.preventDefault();
            document.execCommand(
              "insertText",
              false,
              e.clipboardData.getData("text/plain"),
            );
          }}
        />
      </div>
      <VariableMenu
        scope={scope}
        records={records}
        open={menu}
        onOpenChange={setMenu}
        onPick={insert}
      />
    </div>
  );
}

// Object field (conditions, switch): `a.b.c` path shown as a pill.
export function FieldPicker({
  root,
  objects,
  value,
  onPick,
}: {
  root?: string;
  objects: ObjectInfo[];
  value?: string;
  onPick: (path: string, field: Field) => void;
}) {
  const t = useTranslations("workflows");
  const [open, setOpen] = useState(false);
  const object = objects.find((o) => o.slug === root);
  const current = root && value ? fieldAt(objects, root, value) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={!object}>
        <Button variant="outline" className="min-w-0 flex-1 justify-between">
          {current ? (
            <span className={cn(PILL, "mx-0 truncate")}>
              {current.labels.join(" › ")}
            </span>
          ) : (
            <span className="text-muted-foreground truncate">
              {t("pickers.chooseField")}
            </span>
          )}
          <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        {open && (
          <VariableList
            roots={[
              {
                heading: `${object?.database.name} › ${object?.name}`,
                object: root,
                prefix: "",
              },
            ]}
            objects={objects}
            onPick={(path) => {
              const f = fieldAt(objects, root!, path);
              if (f) onPick(path, f.field);
              setOpen(false);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
