// Saved views of an object: filter, sort and visible columns, under a
// unique name per object. Used by the records table, agents
// (views.*) and pages (query records { view }).
import { appError, notFound } from "../errors/app-error";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireScope } from "../api-keys";
import { audit } from "../audit";
import { objects, objectViews } from "../db/schema";
import { schemaGraph, validateFilter, type Filter } from "../filter";
import { fieldsSchema } from "../objects/fields";
import { withTenant, type TenantContext } from "../tenant";

export type ViewInput = {
  name: string;
  filter?: Filter | null;
  sort?: { field: string; dir?: "asc" | "desc" }[];
  columns?: string[] | null;
};

const res = (id: string) => ({ type: "object_view", id });

export const viewsService = {
  list: async (ctx: TenantContext, objectId: string) => {
    await requireScope(ctx, "read");
    return withTenant(ctx, (tx) =>
      tx
        .select()
        .from(objectViews)
        .where(
          and(
            eq(objectViews.workspaceId, ctx.workspaceId),
            eq(objectViews.objectId, objectId),
          ),
        )
        .orderBy(asc(objectViews.name)),
    );
  },
  get: async (ctx: TenantContext, objectId: string, name: string) => {
    const view = (await viewsService.list(ctx, objectId)).find(
      (v) => v.name === name,
    );
    if (!view)
      throw notFound("views.notFound", "View not found: {name}", { name });
    return view;
  },
  // Creates or replaces the `name` view. Filter, sort and columns are checked
  // against the object schema (relation paths included).
  save: async (ctx: TenantContext, objectId: string, input: ViewInput) => {
    await requireScope(ctx, "write");
    const name = z.string().trim().min(1).parse(input.name);
    return withTenant(ctx, async (tx) => {
      const all = await tx
        .select({ id: objects.id, slug: objects.slug, fields: objects.fields })
        .from(objects)
        .where(eq(objects.workspaceId, ctx.workspaceId));
      const object = all.find((o) => o.id === objectId);
      if (!object) throw notFound("objects.notFound", "Object not found");
      const fields = fieldsSchema.parse(object.fields);
      const filter = input.filter
        ? validateFilter(fields, input.filter, schemaGraph(object.slug, all))
        : null;
      const keys = new Set(fields.map((f) => f.key));
      for (const k of [
        ...(input.sort ?? []).map((s) => s.field),
        ...(input.columns ?? []),
      ])
        if (!keys.has(k))
          throw appError("objects.unknownField", "Unknown field: {field}", {
            field: k,
          });
      const values = {
        filter,
        sort: input.sort ?? [],
        columns: input.columns ?? null,
        updatedAt: new Date(),
      };
      const [row] = await tx
        .insert(objectViews)
        .values({
          organizationId: ctx.organizationId,
          workspaceId: ctx.workspaceId,
          objectId,
          name,
          ...values,
        })
        .onConflictDoUpdate({
          target: [objectViews.objectId, objectViews.name],
          set: values,
        })
        .returning();
      await audit(tx, ctx, "view.save", res(row!.id), { name, ...values });
      return row!;
    });
  },
  remove: async (ctx: TenantContext, objectId: string, name: string) => {
    await requireScope(ctx, "write");
    return withTenant(ctx, async (tx) => {
      const [row] = await tx
        .delete(objectViews)
        .where(
          and(
            eq(objectViews.workspaceId, ctx.workspaceId),
            eq(objectViews.objectId, objectId),
            eq(objectViews.name, name),
          ),
        )
        .returning();
      if (!row)
        throw notFound("views.notFound", "View not found: {name}", { name });
      await audit(tx, ctx, "view.delete", res(row.id), { name });
      return true;
    });
  },
};
