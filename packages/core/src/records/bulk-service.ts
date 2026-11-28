// Bulk operations of recordsService: update / delete by filter (with a
// mandatory preview) and CSV import.
import { and, eq } from "drizzle-orm";
import { ZodError } from "zod";
import { appError, notFound } from "../errors/app-error";
import { requireScope } from "../api-keys";
import { publish } from "../bus";
import { records } from "../db/schema";
import { coerceValues, fieldsSchema, type Field } from "../objects/fields";
import { withTenant, type TenantContext, type Tx } from "../tenant";
import type { Filter } from "../filter";
import { parseCsv } from "./csv";
import { objectsOf, txObjects } from "./helpers";
import { scoped } from "./query";
import { MAX_BULK, type Data } from "./types";
import {
  PROMOTED_WARNING,
  publishUpsert,
  removeInTx,
  updateInTx,
  upsertInTx,
} from "./write";

// Ids of an object's records matching the filter (filter operations).
async function matchingIds(
  tx: Tx,
  ctx: TenantContext,
  objectId: string,
  filter: Filter,
) {
  const { object, where } = await scoped(tx, ctx, objectId, filter);
  const rows = await tx
    .select({ id: records.id })
    .from(records)
    .where(and(eq(records.objectId, object.id), where))
    .limit(MAX_BULK + 1);
  if (rows.length > MAX_BULK)
    throw appError(
      "records.tooManyMatches",
      "More than {max} records match: narrow the filter",
      { max: MAX_BULK },
    );
  return rows.map((r) => r.id);
}

// Mandatory preview of a filter operation: without dryRun, `expected`
// must equal the number of records returned by the preview.
function checkExpected(count: number, expected: number | undefined) {
  if (expected !== count)
    throw expected === undefined
      ? appError(
          "records.previewRequired",
          "Preview required: {count} record(s) affected. Run again with expected: {count} to confirm.",
          { count },
        )
      : appError(
          "records.countChanged",
          "The number of affected records changed ({count} instead of {expected}): preview again.",
          { count, expected },
        );
}

// Value of a CSV cell for a field: JSON array or list separated by
// ";" for multi_select / refs, JSON for json; numbers and booleans
// converted by coerceValues.
function csvValue(f: Field, v: string): unknown {
  const t = v.trim();
  if (["multi_select", "refs", "json"].includes(f.type) && /^[[{]/.test(t))
    try {
      return JSON.parse(t);
    } catch {
      return v;
    }
  if (f.type === "multi_select" || f.type === "refs")
    return t
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean);
  return t;
}

type ImportFailure = {
  line: number;
  field?: string;
  value?: unknown;
  message: string;
};

// Failures of a CSV row: one entry per invalid field for a validation
// error (field, submitted value, message), otherwise the error message.
function rowFailures(line: number, data: Data, e: unknown): ImportFailure[] {
  if (e instanceof ZodError)
    return e.issues.map((i) => {
      const field = i.path.length ? String(i.path[0]) : undefined;
      return {
        line,
        ...(field ? { field, value: data[field] ?? null } : {}),
        message: i.message,
      };
    });
  return [{ line, message: e instanceof Error ? e.message : String(e) }];
}

// Maximum number of failures listed in an import report (failedCount
// gives the total).
const MAX_FAILURES = 50;

type ImportReport = {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: ImportFailure[];
  // Rows that failed (`failed` lists at most MAX_FAILURES entries).
  failedCount: number;
  // Rows whose `match` column is empty (handled per `onEmptyMatch`).
  emptyMatchKey: number;
  skipped: number;
  warnings: string[];
};

// Aborts the transaction of a dry-run import, carrying its report out.
class DryRun extends Error {
  constructor(readonly report: ImportReport) {
    super("dry run");
  }
}

export const bulkOps = {
  // Update by filter: dryRun returns the number of affected records;
  // applying requires expected = that number (mandatory preview).
  updateWhere: async (
    ctx: TenantContext,
    objectId: string,
    input: {
      filter: Filter;
      data: Data;
      dryRun?: boolean;
      expected?: number;
      // true: matched test records stay test data (no promotion to live).
      test?: boolean;
    },
  ) => {
    await requireScope(ctx, "write");
    const results = await withTenant(ctx, async (tx) => {
      const ids = await matchingIds(tx, ctx, objectId, input.filter);
      if (input.dryRun) return ids.length;
      checkExpected(ids.length, input.expected);
      const out = [];
      for (const id of ids)
        out.push(
          await updateInTx(tx, ctx, id, input.data, "merge", {
            test: input.test,
          }),
        );
      return out;
    });
    if (typeof results === "number") return { dryRun: true, count: results };
    for (const r of results) await publishUpsert(ctx, {}, r);
    const promoted = results.filter((r) => r.promoted).length;
    return {
      count: results.length,
      updated: results.filter((r) => r.changed.length).length,
      ...(promoted && {
        promoted,
        warning: `${promoted} ${PROMOTED_WARNING}`,
      }),
    };
  },

  // Delete by filter (to the trash), same mandatory preview.
  deleteWhere: async (
    ctx: TenantContext,
    objectId: string,
    input: { filter: Filter; dryRun?: boolean; expected?: number },
  ) => {
    await requireScope(ctx, "write");
    const ids = await withTenant(ctx, async (tx) => {
      const ids = await matchingIds(tx, ctx, objectId, input.filter);
      if (input.dryRun) return ids.length;
      checkExpected(ids.length, input.expected);
      for (const id of ids) await removeInTx(tx, ctx, id);
      return ids;
    });
    if (typeof ids === "number") return { dryRun: true, count: ids };
    for (const id of ids)
      await publish("record.deleted", { ...ctx, id, objectId });
    return { count: ids.length };
  },

  // CSV import: 1st line = headers, `mapping` column -> field key.
  // `match` (unique field, e.g. email): a row whose value already exists
  // updates that record instead of creating one (duplicates within the file included).
  // Each row is independent: an invalid row is reported without
  // blocking the others. dryRun: same report, nothing is written.
  importCsv: async (
    ctx: TenantContext,
    objectId: string,
    input: {
      csv: string;
      mapping: Record<string, string>;
      match?: string;
      // Row with an empty `match` value: create a new record (default,
      // possible duplicates), skip it, or report it as failed.
      onEmptyMatch?: "create" | "skip" | "fail";
      dryRun?: boolean;
      // Created records are test data (workspace.purge_test).
      test?: boolean;
    },
  ) => {
    await requireScope(ctx, "write");
    const [header = [], ...rows] = parseCsv(input.csv);
    if (rows.length > MAX_BULK)
      throw appError("records.importMax", "Import limited to {max} rows", {
        max: MAX_BULK,
      });
    const run = withTenant(ctx, async (tx) => {
      const object = (await objectsOf(tx, ctx)).find((o) => o.id === objectId);
      if (!object) throw notFound("objects.notFound", "Object not found");
      const fields = fieldsSchema.parse(object.fields);
      const cols = Object.entries(input.mapping).map(([col, key]) => {
        const i = header.indexOf(col);
        const f = fields.find((x) => x.key === key);
        if (i < 0)
          throw appError(
            "records.importMissingColumn",
            "Column missing from file: {column}",
            { column: col },
          );
        if (!f)
          throw appError("objects.unknownField", "Unknown field: {field}", {
            field: key,
          });
        return { i, f };
      });
      if (
        input.match &&
        !cols.some((c) => c.f.key === input.match && c.f.unique)
      )
        throw appError(
          "records.importMatchNotUnique",
          "Deduplication: “{field}” must be a unique field present in the mapping",
          { field: input.match },
        );
      const done: Awaited<ReturnType<typeof upsertInTx>>[] = [];
      const failed: ImportFailure[] = [];
      let failedCount = 0;
      let emptyMatchKey = 0;
      let skipped = 0;
      const onEmpty = input.onEmptyMatch ?? "create";
      for (const [n, r] of rows.entries()) {
        const data: Data = {};
        for (const { i, f } of cols)
          if (r[i] !== undefined && r[i] !== "")
            data[f.key] = csvValue(f, r[i]);
        const match =
          input.match && data[input.match] != null ? input.match : undefined;
        if (input.match && !match) {
          emptyMatchKey++;
          if (onEmpty === "skip") {
            skipped++;
            continue;
          }
          if (onEmpty === "fail") {
            failedCount++;
            if (failed.length < MAX_FAILURES)
              failed.push({
                line: n + 2,
                field: input.match,
                value: null,
                message: `Empty match key “${input.match}”`,
              });
            continue;
          }
        }
        try {
          done.push(
            await tx.transaction((sp) => {
              txObjects.set(sp, objectsOf(tx, ctx));
              return upsertInTx(sp, ctx, {
                objectId,
                data: coerceValues(fields, data),
                match,
                test: input.test,
              });
            }),
          );
        } catch (e) {
          failedCount++;
          if (failed.length < MAX_FAILURES)
            failed.push(...rowFailures(n + 2, data, e));
        }
      }
      const report: ImportReport = {
        total: rows.length,
        created: done.filter((d) => d.created).length,
        updated: done.filter((d) => !d.created && d.changed.length).length,
        unchanged: done.filter((d) => !d.created && !d.changed.length).length,
        failed: failed.slice(0, MAX_FAILURES),
        failedCount,
        emptyMatchKey,
        skipped,
        warnings: emptyMatchKey
          ? [
              `${emptyMatchKey} row(s) have an empty “${input.match}”: ${
                onEmpty === "create"
                  ? "created as new records without deduplication"
                  : onEmpty === "skip"
                    ? "skipped"
                    : "reported as failed"
              } (onEmptyMatch: create | skip | fail).`,
            ]
          : [],
      };
      if (input.dryRun) throw new DryRun(report);
      return { report, done };
    });
    try {
      const { report, done } = await run;
      for (const d of done) await publishUpsert(ctx, {}, d);
      return report;
    } catch (e) {
      if (e instanceof DryRun) return { dryRun: true, ...e.report };
      throw e;
    }
  },
};
