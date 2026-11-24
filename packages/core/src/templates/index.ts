// Export / import of a workspace in the runbase-template.json format.
// The core only knows the format; templates live in `templates/`.
import { appError } from "../errors/app-error";
import { requireScope } from "../api-keys";
import { databasesService } from "../databases";
import { objectsService } from "../objects";
import { fieldsSchema, isComputed, type Field } from "../objects/fields";
import { viewsService } from "../views";
import { functionsService } from "../functions";
import { workflowsService, type Definition } from "../workflows";
import { pagesService } from "../pages";
import { secretsService } from "../secrets";
import { webhooksService } from "../webhooks";
import { recordsService } from "../records";
import type { Filter } from "../filter";
import type { TenantContext } from "../tenant";
import {
  keyOf,
  parseTemplate,
  REF,
  rewrite,
  TEMPLATE_FORMAT,
  TEMPLATE_VERSION,
  type Template,
} from "./format";

export {
  parseTemplate,
  templateSchema,
  TEMPLATE_FORMAT,
  TEMPLATE_VERSION,
  type Template,
  type TemplateInput,
} from "./format";

export const MAX_SAMPLE_RECORDS = 100;

export type ExportOptions = {
  name?: string;
  description?: string;
  // Sample records per object (0 by default, at most MAX_SAMPLE_RECORDS).
  sampleRecords?: number;
};

// Fields created in the first pass: without relations (target may be missing).
const RELATIONAL: Field["type"][] = ["ref", "refs", "lookup", "rollup"];
const sortBy = <T>(list: T[], f: (x: T) => string) =>
  [...list].sort((a, b) => f(a).localeCompare(f(b)));

// Workflows referenced by a definition (`$workflow:key`).
const workflowRefs = (value: unknown) =>
  [...JSON.stringify(value).matchAll(REF)]
    .filter((m) => m[1] === "workflow")
    .map((m) => m[2]!);

const SECRET_REF = /\{\{\s*secret\.([A-Za-z0-9_]+)\s*\}\}/g;

// Secrets required by a workflow definition: `{{secret.X}}` in its
// blocks, and the signing secret of its trigger's webhook.
function workflowSecrets(
  definition: unknown,
  hooks: { name: string; secretName: string }[],
) {
  const names = [...JSON.stringify(definition).matchAll(SECRET_REF)].map(
    (m) => m[1]!,
  );
  const trigger = (
    definition as { trigger?: { type?: string; webhook?: string } }
  ).trigger;
  const hook =
    trigger?.type === "trigger.webhook" &&
    hooks.find((h) => h.name === trigger.webhook);
  if (hook) names.push(hook.secretName);
  return names;
}

export const templatesService = {
  // The whole workspace: objects and schema, views, functions,
  // workflows, pages, names of required secrets, optional sample records.
  export: async (
    ctx: TenantContext,
    opts: ExportOptions = {},
  ): Promise<Template> => {
    await requireScope(ctx, "read");
    const sample = Math.min(
      Math.max(0, Math.floor(opts.sampleRecords ?? 0)),
      MAX_SAMPLE_RECORDS,
    );
    const [dbs, objs, fns, wfs, pageRows, hooks] = await Promise.all([
      databasesService.list(ctx),
      objectsService.list(ctx),
      functionsService.list(ctx),
      workflowsService.list(ctx),
      pagesService.list(ctx),
      webhooksService.list(ctx),
    ]);
    const ids = new Map<string, string>();
    const dbSlug = new Map(dbs.map((d) => [d.id, d.slug]));
    for (const o of objs) ids.set(o.id, `$object:${o.slug}`);
    const taken = new Set<string>();
    const workflows = [];
    for (const w of sortBy(wfs, (w) => w.name)) {
      const k = keyOf(w.name, taken);
      ids.set(w.id, `$workflow:${k}`);
      const full = await workflowsService.get(ctx, w.id);
      workflows.push({ key: k, name: w.name, definition: full!.definition });
    }

    const objects = objs.map((o) => ({
      slug: o.slug,
      name: o.name,
      icon: o.icon,
      database: dbSlug.get(o.databaseId),
      fields: fieldsSchema.parse(o.fields),
    }));
    const usedDbs = new Set(objects.map((o) => o.database));
    const views = [];
    const records: Template["records"] = [];
    const relations = new Map<string, string[]>();
    for (const o of objs) {
      for (const v of await viewsService.list(ctx, o.id))
        views.push({
          object: o.slug,
          name: v.name,
          ...(v.filter != null && { filter: v.filter }),
          sort: v.sort as { field: string; dir?: "asc" | "desc" }[],
          columns: v.columns as string[] | null,
        });
      if (!sample) continue;
      const fields = fieldsSchema.parse(o.fields);
      const computed = new Set(fields.filter(isComputed).map((f) => f.key));
      relations.set(
        o.slug,
        fields
          .filter((f) => f.type === "ref" || f.type === "refs")
          .map((f) => f.key),
      );
      const page = await recordsService.searchPage(ctx, o.id, {
        pagination: { limit: sample },
      });
      for (const r of page.records) {
        const k = `r${records.length + 1}`;
        ids.set(r.id, `$record:${k}`);
        records.push({
          key: k,
          object: o.slug,
          externalId: r.externalId ?? null,
          data: Object.fromEntries(
            Object.entries(r.data as Record<string, unknown>).filter(
              ([f]) => !computed.has(f),
            ),
          ),
        });
      }
    }

    // Relation to a non-exported record: removed (workspace-specific uuid).
    const exported = (v: unknown) => typeof v === "string" && ids.has(v);
    for (const r of records)
      for (const k of relations.get(r.object) ?? []) {
        const v = r.data[k];
        if (v == null) continue;
        if (Array.isArray(v)) r.data[k] = v.filter(exported);
        else if (!exported(v)) delete r.data[k];
      }

    const pages = [];
    for (const p of sortBy(pageRows, (p) => p.name)) {
      const full = await pagesService.get(ctx, p.id);
      if (full)
        pages.push({
          name: p.name,
          icon: p.icon,
          files: full.files,
          entry: full.entry,
          deps: full.deps,
          permissions: full.permissions,
        });
    }
    const functions = fns.map((f) => ({
      name: f.name,
      code: f.code,
      inputSchema: f.inputSchema as Record<string, unknown>,
      outputSchema: f.outputSchema as Record<string, unknown>,
      permissions:
        f.permissions as Template["functions"][number]["permissions"],
      limits: f.limits as Template["functions"][number]["limits"],
    }));
    // Names only: declared by functions, referenced by blocks
    // (`{{secret.X}}`) or by the webhook that triggers a workflow.
    const secrets = [
      ...new Set([
        ...functions.flatMap((f) => f.permissions.secrets),
        ...workflows.flatMap((w) => workflowSecrets(w.definition, hooks)),
      ]),
    ].sort();

    return rewrite(
      {
        format: TEMPLATE_FORMAT,
        version: TEMPLATE_VERSION,
        name: opts.name ?? "Workspace template",
        ...(opts.description && { description: opts.description }),
        databases: dbs
          .filter((d) => usedDbs.has(d.slug))
          .map((d) => ({ slug: d.slug, name: d.name })),
        objects,
        views,
        functions,
        workflows,
        pages,
        secrets,
        records,
      } satisfies Template,
      ids,
    );
  },

  // Creates all template content in the workspace. Refused if an object,
  // or a function with the same name already exists. Workflows created as
  // draft (to activate once the secrets are filled in).
  import: async (ctx: TenantContext, raw: unknown) => {
    await requireScope(ctx, "admin");
    const t = parseTemplate(raw);
    const [dbs, objs, fns, secretRows] = await Promise.all([
      databasesService.list(ctx),
      objectsService.list(ctx),
      functionsService.list(ctx),
      secretsService.list(ctx),
    ]);
    const conflict = (kind: string, name: string) =>
      appError(
        "templates.conflict",
        "Already exists in the workspace: {kind} “{name}”",
        { kind, name },
        { kind: "conflict" },
      );
    for (const o of t.objects)
      if (objs.some((x) => x.slug === o.slug)) throw conflict("object", o.slug);
    for (const f of t.functions)
      if (fns.some((x) => x.name === f.name))
        throw conflict("function", f.name);
    const order = sortWorkflows(t.workflows);

    const refs = new Map<string, string>();
    for (const d of t.databases)
      if (!dbs.some((x) => x.slug === d.slug))
        await databasesService.create(ctx, d);

    // Objects in two passes: simple fields, then relations (cycles allowed).
    const created = new Map<string, string>();
    for (const o of t.objects) {
      const row = await objectsService.create(ctx, {
        slug: o.slug,
        name: o.name,
        icon: o.icon ?? null,
        database: o.database,
        fields: o.fields.filter((f) => !RELATIONAL.includes(f.type)),
      });
      created.set(o.slug, row.id);
      refs.set(`$object:${o.slug}`, row.id);
    }
    for (const o of t.objects)
      if (o.fields.some((f) => RELATIONAL.includes(f.type)))
        await objectsService.update(ctx, created.get(o.slug)!, {
          fields: rewrite(o.fields, refs),
        });

    for (const v of t.views)
      await viewsService.save(ctx, created.get(v.object)!, {
        name: v.name,
        filter: (v.filter ?? null) as Filter | null,
        sort: v.sort,
        columns: v.columns,
      });

    // Records: without references first, then the `$record:` references.
    const pending: { id: string; data: Record<string, unknown> }[] = [];
    for (const r of t.records) {
      const data = rewrite(r.data, refs);
      const plain = Object.fromEntries(
        Object.entries(data).filter(([, v]) => !hasRef(v, "record")),
      );
      const res = await recordsService.upsert(ctx, {
        objectId: created.get(r.object)!,
        externalId: r.externalId ?? null,
        data: plain,
      });
      refs.set(`$record:${r.key}`, res.record.id);
      if (Object.keys(plain).length < Object.keys(data).length)
        pending.push({ id: res.record.id, data });
    }
    for (const p of pending)
      await recordsService.update(ctx, p.id, rewrite(p.data, refs));

    for (const f of t.functions)
      await functionsService.create(ctx, rewrite(f, refs));

    // Pages: a workflow referenced by a page must already exist.
    const workflowIds: string[] = [];
    for (const w of order) {
      const row = await workflowsService.create(ctx, {
        name: w.name,
        definition: rewrite(w.definition, refs) as Definition,
      });
      refs.set(`$workflow:${w.key}`, row.id);
      workflowIds.push(row.id);
    }

    const pageIds: string[] = [];
    for (const p of t.pages) {
      const row = await pagesService.create(ctx, {
        name: p.name,
        icon: p.icon,
        files: p.files,
        entry: p.entry,
        deps: p.deps,
        permissions: rewrite(p.permissions ?? {}, refs),
        publish: true,
      });
      pageIds.push(row.id);
    }

    const have = new Set(secretRows.map((s) => s.name));
    return {
      name: t.name,
      objects: t.objects.length,
      views: t.views.length,
      functions: t.functions.length,
      workflows: workflowIds,
      pages: pageIds,
      records: t.records.length,
      // Secrets to fill in (secrets.set) before activating the workflows.
      missingSecrets: t.secrets.filter((s) => !have.has(s)),
    };
  },
};

const hasRef = (v: unknown, kind: string): boolean =>
  [...JSON.stringify(v ?? null).matchAll(REF)].some((m) => m[1] === kind);

// Creation order: a workflow called by another one is created before it.
function sortWorkflows(list: Template["workflows"]) {
  const byKey = new Map(list.map((w) => [w.key, w]));
  const out: Template["workflows"] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (w: Template["workflows"][number]) => {
    if (state.get(w.key) === "done") return;
    if (state.get(w.key) === "visiting")
      throw appError(
        "templates.workflowCycle",
        "Workflows reference each other in a cycle: {workflow}",
        { workflow: w.key },
      );
    state.set(w.key, "visiting");
    for (const k of workflowRefs(w.definition)) {
      const dep = byKey.get(k);
      if (dep && dep !== w) visit(dep);
    }
    state.set(w.key, "done");
    out.push(w);
  };
  list.forEach(visit);
  return out;
}
