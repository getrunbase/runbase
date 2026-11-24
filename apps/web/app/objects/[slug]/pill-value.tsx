"use client";

import { baseType, type Field } from "@runbase/core/objects/fields";
import { Input } from "@runbase/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Value editor of a filter pill: a select for enumerable fields, a text or date input otherwise.
export function PillValue({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: string;
  onChange: (v: string) => void;
}) {
  const options =
    field.type === "select" || field.type === "multi_select"
      ? field.options
      : field.type === "bool"
        ? ["true", "false"]
        : null;
  if (options)
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger size="sm" className="h-6 border-0 shadow-none">
          <SelectValue placeholder="…" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  return (
    <Input
      autoFocus
      className="h-6 w-28 border-0 px-1 text-xs shadow-none"
      type={baseType(field) === "date" ? "date" : "text"}
      defaultValue={value}
      onBlur={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onChange(e.currentTarget.value);
      }}
    />
  );
}
