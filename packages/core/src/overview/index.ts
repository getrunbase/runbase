// Overview of a workspace (workspace.describe) and purge of test
// data (workspace.purge_test). Aggregates existing services, without its own
// logic: an agent discovers the whole workspace in one call.
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { requireScope } from "../api-keys";
import { audit } from "../audit";
import { databasesService } from "../databases";
import { events, records, workflowRuns } from "../db/schema";
import { errorsService } from "../errors";
import { requireConfirm } from "../errors/app-error";
import { functionsService } from "../functions";
import { objectsService } from "../objects";
import { pagesService } from "../pages";
import { queryService } from "../query";
import { removeInTx, recordsService } from "../records";
import { ACTIVE_RUN_STATUSES } from "../runs";
import { secretsService } from "../secrets";
import { webhooksService } from "../webhooks";
import { workflowsService } from "../workflows";
import { withTenant, type TenantContext } from "../tenant";

// Beyond that, purge_test asks to rerun (bounded batch per call).
const PURGE_BATCH = 5_000;

export const overviewService = {
  describe: async (ctx: TenantContext) => {
    await requireScope(ctx, "read");
    const [dbs, objs, wfs, fns, hooks, pages, secrets, sqlViews] =
      await Promise.all([
        databasesService.list(ctx),
        objectsService.list(ctx),
        workflowsService.list(ctx),
        functionsService.list(ctx),
        webhooksService.list(ctx),
        pagesService.list(ctx),
        secretsService.list(ctx),
        queryService.views(ctx),
      ]);
    const counts = await withTenant(ctx, async (tx) => {
      const perObject = await tx
        .select({
          objectId: records.objectId,
          n: sql<number>`count(*)`.mapWith(Number),
        })
        .from(records)
        .where(eq(records.workspaceId, ctx.workspaceId))
        .groupBy(records.objectId);
      const [ev] = await tx
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(events)
        .where(eq(events.workspaceId, ctx.workspaceId));
      const runs = await tx
        .select({
          status: workflowRuns.status,
          n: sql<number>`count(*)`.mapWith(Number),
        })
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.workspaceId, ctx.workspaceId),
            inArray(workflowRuns.status, [...ACTIVE_RUN_STATUSES]),
          ),
        )
        .groupBy(workflowRuns.status);
      return { perObject, events: ev?.n ?? 0, runs };
    });
    const recordsOf = (id: string) =>
      counts.perObject.find((c) => c.objectId === id)?.n ?? 0;
    const workflows = await Promise.all(
      wfs.map(async (w) => {
        const full = await workflowsService.get(ctx, w.id);
        const def = (full?.definition ?? {}) as {
          trigger?: unknown;
          steps?: { id: string; type: string }[];
        };
        return {
          id: w.id,
          name: w.name,
          status: w.status,
          version: w.currentVersion,
          trigger: def.trigger ?? null,
          steps: (def.steps ?? []).map((s) => ({ id: s.id, type: s.type })),
        };
      }),
    );
    return {
      databases: dbs.map((d) => ({
        ...d,
        objects: objs
          .filter((o) => o.databaseId === d.id)
          .map((o) => ({
            id: o.id,
            slug: o.slug,
            name: o.name,
            fields: o.fields,
            records: recordsOf(o.id),
          })),
      })),
      workflows,
      functions: fns.map((f) => ({
        name: f.name,
        version: f.version,
        inputSchema: f.inputSchema,
        outputSchema: f.outputSchema,
        permissions: f.permissions,
        limits: f.limits,
      })),
      // Without the last received payload (large): webhooks.list gives it.
      webhooks: hooks.map((h) => ({ ...h, sample: undefined })),
      pages,
      secrets: secrets.map((s) => s.name),
      // Views readable by query.sql: name, columns, types.
      sqlViews,
      counts: {
        records: counts.perObject.reduce((a, c) => a + c.n, 0),
        events: counts.events,
        activeRuns: Object.fromEntries(counts.runs.map((r) => [r.status, r.n])),
        openErrors: await errorsService.openCount(ctx),
      },
    };
  },

  // Deletes records, events and runs marked as test. Records: trash
  // (relations removed cleanly) then permanent purge. dryRun: counts.
  purgeTest: async (
    ctx: TenantContext,
    opts: { confirm?: boolean; dryRun?: boolean } = {},
  ) => {
    await requireScope(ctx, "admin");
    const ws = (t: typeof records | typeof events | typeof workflowRuns) =>
      eq(t.workspaceId, ctx.workspaceId);
    const count = () =>
      withTenant(ctx, async (tx) => {
        const n = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
        const c = sql<number>`count(*)`.mapWith(Number);
        return {
          records: await n(
            tx
              .select({ n: c })
              .from(records)
              .where(and(ws(records), eq(records.isTest, true))),
          ),
          events: await n(
            tx
              .select({ n: c })
              .from(events)
              .where(and(ws(events), eq(events.isTest, true))),
          ),
          runs: await n(
            tx
              .select({ n: c })
              .from(workflowRuns)
              .where(and(ws(workflowRuns), eq(workflowRuns.isTest, true))),
          ),
        };
      });
    if (opts.dryRun) return { dryRun: true, ...(await count()) };
    requireConfirm(opts.confirm, "overview.purgeConfirm", "Test data purge");
    const out = await withTenant(ctx, async (tx) => {
      const ids = (
        await tx
          .select({ id: records.id })
          .from(records)
          .where(and(ws(records), eq(records.isTest, true)))
          .limit(PURGE_BATCH)
      ).map((r) => r.id);
      for (const id of ids) await removeInTx(tx, ctx, id);
      const ev = await tx
        .delete(events)
        .where(and(ws(events), eq(events.isTest, true)))
        .returning({ id: events.id });
      const runs = await tx
        .delete(workflowRuns)
        .where(
          and(
            ws(workflowRuns),
            eq(workflowRuns.isTest, true),
            // An active run is still executed by the worker: leave it.
            notInArray(workflowRuns.status, [...ACTIVE_RUN_STATUSES]),
          ),
        )
        .returning({ id: workflowRuns.id });
      await audit(
        tx,
        ctx,
        "workspace.purge_test",
        { type: "workspace", id: ctx.workspaceId },
        { records: ids.length, events: ev.length, runs: runs.length },
      );
      return { ids, events: ev.length, runs: runs.length };
    });
    if (out.ids.length) await recordsService.purge(ctx, { ids: out.ids });
    return {
      records: out.ids.length,
      events: out.events,
      runs: out.runs,
      hasMore: out.ids.length === PURGE_BATCH,
    };
  },
};
