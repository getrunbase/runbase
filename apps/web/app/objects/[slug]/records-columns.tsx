"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, Maximize2 } from "lucide-react";
import { baseType, type Field } from "@runbase/core/objects/fields";
import { FIELD_ICONS as ICONS } from "@/lib/field-icons";
import { Button } from "@runbase/ui/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { Row } from "./actions";
import { RefSelect } from "./ref-select";
import { Cell } from "./cells";

// Column definitions of the records table: selection/open column,
// then one sortable column per field with an inline editor.
export function useRecordColumns({
  fields,
  onOpen,
  labels,
  setLabels,
  save,
}: {
  fields: Field[];
  onOpen: (id: string) => void;
  labels: Record<string, string>;
  setLabels: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  save: (id: string, key: string, value: unknown) => void;
}) {
  const t = useTranslations("objects.table");
  return useMemo<ColumnDef<Row>[]>(
    () => [
      {
        id: "select",
        size: 64,
        enableSorting: false,
        header: ({ table }) => (
          <Checkbox
            aria-label={t("selectAll")}
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && "indeterminate")
            }
            onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
          />
        ),
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Checkbox
              aria-label={t("select")}
              checked={row.getIsSelected()}
              onCheckedChange={(v) => row.toggleSelected(!!v)}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label={t("open")}
              onClick={() => onOpen(row.original.id)}
            >
              <Maximize2 className="size-3.5" />
            </Button>
          </div>
        ),
      },
      ...fields.map((f): ColumnDef<Row> => ({
        id: f.key,
        enableSorting: baseType(f) !== "virtual",
        accessorFn: (r) => r.data[f.key],
        header: ({ column }) => {
          const Icon = ICONS[f.type];
          const dir = column.getIsSorted();
          return (
            <button
              type="button"
              className="flex items-center gap-1.5"
              onClick={column.getToggleSortingHandler()}
            >
              <Icon className="size-3.5 text-muted-foreground" />
              {f.label}
              {dir === "asc" && <ArrowUp className="size-3" />}
              {dir === "desc" && <ArrowDown className="size-3" />}
            </button>
          );
        },
        cell: ({ row }) =>
          f.type === "ref" || f.type === "refs" ? (
            <RefSelect
              object={f.object}
              multiple={f.type === "refs"}
              value={[row.original.data[f.key] ?? []].flat().map((id) => ({
                id: id as string,
                label: labels[id as string] ?? (id as string).slice(0, 8),
              }))}
              onSave={(v, links) => {
                setLabels((m) => ({
                  ...m,
                  ...Object.fromEntries(links.map((l) => [l.id, l.label])),
                }));
                save(row.original.id, f.key, v);
              }}
            />
          ) : (
            <Cell
              field={f}
              value={row.original.data[f.key]}
              onSave={(v) => save(row.original.id, f.key, v)}
            />
          ),
      })),
    ],
    [fields, onOpen, labels, t],
  );
}
