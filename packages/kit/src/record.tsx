/** @jsxRuntime automatic */
// Record sheet: RecordForm (generated from the object schema,
// react-hook-form + zod) and RecordDetail (read-only).
import { Controller, useForm, type Resolver } from "react-hook-form";
import type { Row } from "@getrunbase/sdk";
import { Button } from "@ui/button";
import { Checkbox } from "@ui/checkbox";
import { Field as FieldUi, FieldError, FieldGroup, FieldLabel } from "@ui/field";
import { Input as InputUi } from "@ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ui/select";
import { Textarea } from "@ui/textarea";
import { sdk } from "./sdk";
import { BlockState, labelsOf, type Labels } from "./state";
import {
  formFields,
  INPUT_TYPE,
  initialValues,
  recordSchema,
  type ErrorText,
  type Input,
  type Option,
} from "./form";
import { at, cellText, columnsFromFields, titleOf, type Field } from "./table";
import { useFields } from "./views";

type Values = Record<string, Input>;

// Relation options: records of the target object (title = label).
function useRefOptions(f: Field, given?: Option[]): Option[] {
  const res = sdk().useQuery({
    object: f.object ?? "",
    limit: 200,
    enabled: !given && !!f.object,
  });
  return given ?? res.data.map((r) => ({ value: r.id, label: titleOf(r) }));
}

function Choice({
  f,
  value,
  onChange,
  options,
  none,
}: {
  f: Field;
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  none: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={f.key} className="w-full">
        <SelectValue placeholder={none} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RefChoice(p: {
  f: Field;
  value: string;
  onChange: (v: string) => void;
  given?: Option[];
  none: string;
}) {
  return <Choice {...p} options={useRefOptions(p.f, p.given)} />;
}

export type RecordFormProps = {
  object: string;
  // Absent: creation.
  recordId?: string;
  // Displayed fields, in this order (default: all editable fields).
  fields?: string[];
  exclude?: string[];
  // Imposed options of a relation (otherwise loaded from the target object).
  options?: Record<string, Option[]>;
  labels?: Labels;
  // Error messages translated by the page (default: English).
  errorText?: ErrorText;
  onSaved?: (row: Row) => void;
};

export function RecordForm({
  object,
  recordId,
  fields: include,
  exclude,
  options,
  labels,
  errorText,
  onSaved,
}: RecordFormProps) {
  const l = labelsOf(labels);
  const s = sdk();
  const schema = useFields(object);
  const rec = s.useRecord(recordId);
  const { create, update, pending } = s.useMutation(object);
  const fields = formFields(schema.fields, include, exclude);
  const zod = recordSchema(fields, {
    t: errorText,
    options: Object.fromEntries(
      Object.entries(options ?? {}).map(([k, os]) => [k, os.map((o) => o.value)]),
    ),
  });
  const resolver: Resolver<Values> = async (values) => {
    const r = zod.safeParse(values);
    return r.success
      ? { values: r.data as Values, errors: {} }
      : {
          values: {},
          errors: Object.fromEntries(
            r.error.issues.map((i) => [String(i.path[0]), { type: "custom", message: i.message }]),
          ),
        };
  };
  const form = useForm<Values>({
    resolver,
    values: initialValues(fields, rec.data as Row | undefined),
  });
  const submit = form.handleSubmit(async (data) => {
    const r = recordId ? await update(recordId, data) : await create(data);
    if (r.ok) onSaved?.(r.data);
  });
  return (
    <BlockState
      loading={schema.loading || (!!recordId && rec.loading)}
      error={schema.error ?? rec.error}
      labels={labels}
    >
      <form onSubmit={submit} noValidate data-kit="record-form">
        <FieldGroup>
          {fields.map((f) => {
            const err = form.formState.errors[f.key]?.message;
            const label = f.label ?? f.key;
            return (
              <Controller
                key={f.key}
                control={form.control}
                name={f.key}
                render={({ field }) => {
                  const v = field.value;
                  const text = typeof v === "string" ? v : "";
                  const input =
                    f.type === "bool" ? (
                      <Checkbox id={f.key} checked={v === true} onCheckedChange={(c) => field.onChange(c === true)} />
                    ) : f.type === "select" ? (
                      <Choice
                        f={f}
                        value={text}
                        onChange={field.onChange}
                        options={options?.[f.key] ?? (f.options ?? []).map((o) => ({ value: o, label: o }))}
                        none={l.none}
                      />
                    ) : f.type === "ref" ? (
                      <RefChoice f={f} value={text} onChange={field.onChange} given={options?.[f.key]} none={l.none} />
                    ) : f.type === "multi_select" || f.type === "refs" ? (
                      <div className="flex flex-wrap gap-3">
                        {(options?.[f.key] ?? (f.options ?? []).map((o) => ({ value: o, label: o }))).map((o) => {
                          const list = Array.isArray(v) ? v : [];
                          return (
                            <label key={o.value} className="flex items-center gap-1.5 text-sm">
                              <Checkbox
                                checked={list.includes(o.value)}
                                onCheckedChange={(c) =>
                                  field.onChange(c ? [...list, o.value] : list.filter((x) => x !== o.value))
                                }
                              />
                              {o.label}
                            </label>
                          );
                        })}
                      </div>
                    ) : f.type === "json" ? (
                      <Textarea id={f.key} value={text} onChange={field.onChange} onBlur={field.onBlur} />
                    ) : (
                      <InputUi
                        id={f.key}
                        type={INPUT_TYPE[f.type] ?? "text"}
                        value={text}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        aria-invalid={!!err}
                      />
                    );
                  return (
                    <FieldUi data-invalid={!!err || undefined} orientation={f.type === "bool" ? "horizontal" : "vertical"}>
                      <FieldLabel htmlFor={f.key}>
                        {label}
                        {f.required && <span className="text-destructive">*</span>}
                      </FieldLabel>
                      {input}
                      {err && <FieldError>{err}</FieldError>}
                    </FieldUi>
                  );
                }}
              />
            );
          })}
          <Button type="submit" disabled={pending} className="self-start">
            {pending ? l.saving : l.save}
          </Button>
        </FieldGroup>
      </form>
    </BlockState>
  );
}

export type RecordDetailProps = {
  object: string;
  recordId: string;
  fields?: string[];
  labels?: Labels;
  locale?: string;
};

// Record detail: label and formatted value of each field.
export function RecordDetail({ object, recordId, fields, labels, locale }: RecordDetailProps) {
  const l = labelsOf(labels);
  const schema = useFields(object);
  const rec = sdk().useRecord(recordId);
  const cols = columnsFromFields(schema.fields, fields);
  return (
    <BlockState
      loading={schema.loading || rec.loading}
      error={schema.error ?? rec.error}
      empty={!rec.data}
      labels={labels}
    >
      <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-2 text-sm" data-kit="record-detail">
        {cols.map((c) => (
          <div key={c.key} className="contents">
            <dt className="text-muted-foreground">{c.label}</dt>
            <dd>{cellText(at(rec.data, c.key), c, { locale, yesNo: [l.yes, l.no] }) || l.none}</dd>
          </div>
        ))}
      </dl>
    </BlockState>
  );
}
