"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFieldArray, useForm } from "react-hook-form";
import { SlidersHorizontal, Star, Trash2 } from "lucide-react";
import { baseType, isComputed, type Field } from "@getrunbase/core/objects/fields";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@getrunbase/ui/components/ui/badge";
import { Button } from "@getrunbase/ui/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { Input } from "@getrunbase/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { makeLabels } from "../workflows/labels";
import { useErrorText } from "@/lib/error-text";
import { createDatabase } from "../databases/actions";
import { saveObject } from "./actions";
import { toField, toRow, type FieldRow } from "./schema";

// Types by family; relations are chosen by target object
// ("→ Contacts"). Computed ones are filled by the platform.
const GROUPS: {
  label: "input" | "lists" | "contact" | "files" | "computed";
  types: Field["type"][];
}[] = [
  {
    label: "input",
    types: ["text", "number", "currency", "percent", "rating", "bool", "date"],
  },
  { label: "lists", types: ["select", "multi_select"] },
  { label: "contact", types: ["email", "phone", "url", "user"] },
  { label: "files", types: ["file", "json"] },
  {
    label: "computed",
    types: [
      "formula",
      "lookup",
      "rollup",
      "autonumber",
      "created_at",
      "updated_at",
      "created_by",
    ],
  },
];
const isRel = (t: string) => t === "ref" || t === "refs";

// Possible target object of a relation, in any database.
export type Target = { slug: string; name: string; database: string };
const hasOptions = (t: string) => t === "select" || t === "multi_select";
const blank = (): FieldRow => ({
  key: "",
  label: "",
  type: "text",
  options: "",
});

// Object schema editor: name, fields (add, rename,
// delete), type and select options. Also: title field, relation
// chosen in the type, empty row always available at the end of the list,
// creation possible with a new database (`newDatabase`).
export function SchemaEditor({
  object,
  database,
  newDatabase,
  targets,
  onDone,
}: {
  object?: { id: string; name: string; fields: Field[] };
  database?: string;
  newDatabase?: boolean;
  targets: Target[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const t = useTranslations("objects.editor");
  const tc = useTranslations("common");
  const { fieldType: fieldTypeLabel } = makeLabels(
    useTranslations("workflows"),
  );
  const errorText = useErrorText();
  const [error, setError] = useState<string>();
  // Rows whose rules (validation, default) are expanded.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const form = useForm<{ db: string; name: string; fields: FieldRow[] }>({
    defaultValues: {
      db: "",
      name: object?.name ?? "",
      fields: object?.fields.map(toRow) ?? [
        { ...blank(), label: t("defaultTitle"), title: true },
        blank(),
      ],
    },
  });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "fields",
  });
  // An empty row is always available at the end of the list.
  const rows = form.watch("fields");
  const last = rows.at(-1);
  const lastUsed = !last || !!last.label.trim() || last.type !== "text";
  useEffect(() => {
    if (lastUsed) append(blank(), { shouldFocus: false });
  }, [lastUsed, append]);

  const submit = form.handleSubmit(async (v) => {
    const list = v.fields.filter((f) => f.label.trim()).map(toField);
    // No title chosen: the first text field.
    if (!list.some((f) => f.title)) {
      const first = list.find((f) => f.type === "text");
      if (first) first.title = true;
    }
    const res = newDatabase
      ? await createDatabase({ name: v.db, object: v.name, fields: list })
      : await saveObject({
          id: object?.id,
          name: v.name,
          database,
          fields: list,
        });
    if (res.error) return setError(errorText(res.error));
    setError(undefined);
    onDone?.();
    if (newDatabase) router.push(`/databases/${res.slug}`);
    // From a database: stay there to chain the next object.
    else if (!object && !database) router.push(`/objects/${res.slug}`);
    else router.refresh();
  });

  return (
    <Form {...form}>
      <form onSubmit={submit} className="space-y-4">
        {newDatabase && (
          <FormField
            control={form.control}
            name="db"
            rules={{ required: true }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("databaseName")}</FormLabel>
                <FormControl>
                  <Input
                    placeholder={t("databasePlaceholder")}
                    autoFocus
                    {...field}
                  />
                </FormControl>
              </FormItem>
            )}
          />
        )}
        <FormField
          control={form.control}
          name="name"
          rules={{ required: true }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {newDatabase ? t("firstObject") : t("objectName")}
              </FormLabel>
              <FormControl>
                <Input
                  placeholder={
                    newDatabase
                      ? t("firstObjectPlaceholder")
                      : t("objectPlaceholder")
                  }
                  autoFocus={!newDatabase}
                  {...field}
                />
              </FormControl>
            </FormItem>
          )}
        />
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs">{t("titleHint")}</p>
          {fields.map((row, i, all) => {
            const hasKeys = all.some((r) => r.key);
            const type = form.watch(`fields.${i}.type`);
            return (
              <div key={row.id} className="flex flex-wrap items-center gap-2">
                <Input
                  aria-label={t("label")}
                  placeholder={t("label")}
                  className="flex-1"
                  {...form.register(`fields.${i}.label`)}
                />
                <Select
                  value={
                    isRel(type)
                      ? `${type}:${form.watch(`fields.${i}.object`) ?? ""}`
                      : type
                  }
                  onValueChange={(v) => {
                    const [ft, target] = v.split(":") as [
                      Field["type"],
                      string?,
                    ];
                    form.setValue(`fields.${i}.type`, ft);
                    form.setValue(`fields.${i}.object`, target);
                    // Relation: default label = target object name.
                    if (target && !form.getValues(`fields.${i}.label`).trim())
                      form.setValue(
                        `fields.${i}.label`,
                        targets.find((x) => x.slug === target)?.name ?? "",
                      );
                  }}
                >
                  <SelectTrigger aria-label={t("type")} className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GROUPS.map((g) => (
                      <SelectGroup key={g.label}>
                        <SelectLabel>{t(`groups.${g.label}`)}</SelectLabel>
                        {g.types.map((ft) => (
                          <SelectItem key={ft} value={ft}>
                            {fieldTypeLabel(ft)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                    {targets.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>{t("relationTo")}</SelectLabel>
                        {targets.map((x) => (
                          <SelectItem key={x.slug} value={`ref:${x.slug}`}>
                            {t("relationOne", { name: x.name })}
                          </SelectItem>
                        ))}
                        {targets.map((x) => (
                          <SelectItem key={x.slug} value={`refs:${x.slug}`}>
                            {t("relationMany", { name: x.name })}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("titleField")}
                  aria-pressed={!!rows[i]?.title}
                  title={t("titleFieldHint")}
                  onClick={() =>
                    rows.forEach((_, j) =>
                      form.setValue(`fields.${j}.title`, j === i),
                    )
                  }
                >
                  <Star
                    className={
                      rows[i]?.title ? "fill-primary text-primary" : ""
                    }
                  />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("settingsAria")}
                  aria-pressed={open[row.id] ?? false}
                  title={t("settings")}
                  onClick={() =>
                    setOpen((o) => ({ ...o, [row.id]: !o[row.id] }))
                  }
                >
                  <SlidersHorizontal />
                </Button>
                {/* Fixed width: columns aligned from one row to the next. */}
                {row.key ? (
                  <Badge
                    variant="secondary"
                    className="w-24 justify-center truncate"
                    title={row.key}
                  >
                    {row.key}
                  </Badge>
                ) : (
                  hasKeys && <span className="w-24" />
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("removeField")}
                  onClick={() => remove(i)}
                >
                  <Trash2 />
                </Button>
                {(open[row.id] || NEEDS_SETUP.includes(type)) && (
                  <FieldSettings
                    type={type}
                    rules={!!open[row.id]}
                    config={form.watch(`fields.${i}.config`) ?? {}}
                    relations={rows.filter((r) => isRel(r.type) && r.key)}
                    targets={targets}
                    onChange={(c) => form.setValue(`fields.${i}.config`, c)}
                  />
                )}
                {hasOptions(type) && (
                  <div className="w-full space-y-1 pl-2">
                    <Input
                      aria-label={t("options")}
                      placeholder={t("optionsPlaceholder")}
                      {...form.register(`fields.${i}.options`)}
                    />
                    <div className="flex flex-wrap gap-1">
                      {form
                        .watch(`fields.${i}.options`)
                        .split(",")
                        .map((o) => o.trim())
                        .filter(Boolean)
                        .map((o) => (
                          <Badge key={o} variant="outline">
                            {o}
                          </Badge>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => append(blank())}
          >
            {t("addField")}
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {object
              ? tc("save")
              : newDatabase
                ? t("createDatabase")
                : t("createObject")}
          </Button>
        </div>
      </form>
    </Form>
  );
}

// Types that need configuration to work: settings always visible.
const NEEDS_SETUP: Field["type"][] = ["formula", "lookup", "rollup"];

// Field settings: type-specific (formula, followed relation, currency,
// scale) and, when expanded, validation rules and default value.
function FieldSettings({
  type,
  rules,
  config,
  relations,
  targets,
  onChange,
}: {
  type: Field["type"];
  rules: boolean;
  config: Record<string, unknown>;
  relations: FieldRow[];
  targets: Target[];
  onChange: (c: Record<string, unknown>) => void;
}) {
  const t = useTranslations("objects.settings");
  const set = (k: string, v: unknown) => onChange({ ...config, [k]: v });
  const text = (k: string) => (config[k] as string | undefined) ?? "";
  const num = (k: string) => (config[k] === undefined ? "" : String(config[k]));
  const numInput = (k: string, label: string) => (
    <Input
      aria-label={label}
      placeholder={label}
      type="number"
      className="w-32"
      value={num(k)}
      onChange={(e) =>
        set(k, e.target.value === "" ? undefined : Number(e.target.value))
      }
    />
  );
  const b = baseType({ key: "x", label: "x", type } as Field);
  const computed = isComputed({ key: "x", label: "x", type } as Field);
  return (
    <div className="bg-muted/40 w-full space-y-2 rounded-md p-3 text-sm">
      {type === "formula" && (
        <div className="space-y-1">
          <Input
            aria-label={t("formula")}
            placeholder={t("formulaPlaceholder")}
            className="font-mono"
            value={text("formula")}
            onChange={(e) => set("formula", e.target.value)}
          />
          <p className="text-muted-foreground text-xs">{t("formulaHelp")}</p>
          <Select
            value={text("result") || "text"}
            onValueChange={(v) => set("result", v)}
          >
            <SelectTrigger aria-label={t("resultType")} className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">{t("result.text")}</SelectItem>
              <SelectItem value="number">{t("result.number")}</SelectItem>
              <SelectItem value="bool">{t("result.bool")}</SelectItem>
              <SelectItem value="date">{t("result.date")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {(type === "lookup" || type === "rollup") && (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={text("through")}
            onValueChange={(v) => set("through", v)}
          >
            <SelectTrigger aria-label={t("through")} className="w-60">
              <SelectValue placeholder={t("throughPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {relations.length > 0 && (
                <SelectGroup>
                  <SelectLabel>{t("ownRelations")}</SelectLabel>
                  {relations.map((r) => (
                    <SelectItem key={r.key} value={r.key}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              <SelectGroup>
                <SelectLabel>{t("backRelations")}</SelectLabel>
                {targets.map((x) => (
                  <SelectItem key={x.slug} value={x.slug}>
                    {x.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {type === "rollup" && (
            <Select value={text("op")} onValueChange={(v) => set("op", v)}>
              <SelectTrigger aria-label={t("op")} className="w-40">
                <SelectValue placeholder={t("op")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="count">{t("ops.count")}</SelectItem>
                <SelectItem value="sum">{t("ops.sum")}</SelectItem>
                <SelectItem value="avg">{t("ops.avg")}</SelectItem>
                <SelectItem value="min">{t("ops.min")}</SelectItem>
                <SelectItem value="max">{t("ops.max")}</SelectItem>
              </SelectContent>
            </Select>
          )}
          {(type === "lookup" || text("op") !== "count") && (
            <Input
              aria-label={t("field")}
              placeholder={t("fieldPlaceholder")}
              className="w-56"
              value={text("field")}
              onChange={(e) => set("field", e.target.value)}
            />
          )}
        </div>
      )}
      {type === "currency" && (
        <Input
          aria-label={t("currency")}
          placeholder={t("currencyPlaceholder")}
          maxLength={3}
          className="w-32 uppercase"
          value={text("currency")}
          onChange={(e) => set("currency", e.target.value.toUpperCase())}
        />
      )}
      {type === "rating" && numInput("scale", t("scale"))}
      {rules && !computed && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2">
            <Checkbox
              checked={config.required === true}
              onCheckedChange={(v) => set("required", v === true || undefined)}
            />
            {t("required")}
          </label>
          {b !== "json" && type !== "file" && (
            <Input
              aria-label={t("default")}
              placeholder={t("default")}
              className="w-44"
              value={config.default === undefined ? "" : String(config.default)}
              onChange={(e) =>
                set(
                  "default",
                  e.target.value === ""
                    ? undefined
                    : b === "number"
                      ? Number(e.target.value)
                      : b === "bool"
                        ? e.target.value === "true"
                        : e.target.value,
                )
              }
            />
          )}
          {b === "number" && (
            <>
              {numInput("min", t("min"))}
              {numInput("max", t("max"))}
            </>
          )}
          {b === "text" && (
            <>
              {numInput("minLength", t("minLength"))}
              {numInput("maxLength", t("maxLength"))}
              <Input
                aria-label={t("pattern")}
                placeholder={t("patternPlaceholder")}
                className="w-52 font-mono"
                value={text("pattern")}
                onChange={(e) => set("pattern", e.target.value)}
              />
            </>
          )}
        </div>
      )}
      {rules && computed && !NEEDS_SETUP.includes(type) && (
        <p className="text-muted-foreground text-xs">{t("auto")}</p>
      )}
    </div>
  );
}
