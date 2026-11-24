// MCP tools: databases, objects, templates, catalog and saved views.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { TenantContext } from "@runbase/core/tenant";
import { databasesService } from "@runbase/core/databases";
import { fieldSchema, objectsService } from "@runbase/core/objects";
import { filterSchema } from "@runbase/core/filter";
import { notFound } from "@runbase/core/errors";
import { catalogService, submissionSchema } from "@runbase/core/catalog";
import { viewsService } from "@runbase/core/views";
import { MAX_SAMPLE_RECORDS, templatesService } from "@runbase/core/templates";
import { run, getObject, objectId, slug } from "./shared";

export function defineSchemaTools(server: McpServer, ctx: TenantContext) {
  // Databases
  const dbSlug = z.string().describe("Database slug");
  const getDatabase = async (slug: string) => {
    const d = await databasesService.get(ctx, slug);
    if (!d)
      throw notFound(
        "mcp.databaseNotFound",
        "Database not found: {slug}. See databases.list.",
        { slug },
      );
    return d;
  };
  server.registerTool(
    "databases.list",
    { description: "Lists the workspace databases (groups of objects)." },
    () => run(() => databasesService.list(ctx)),
  );
  server.registerTool(
    "databases.get",
    {
      description: "Reads a database and its objects.",
      inputSchema: z.object({ database: dbSlug }),
    },
    ({ database }) => run(() => getDatabase(database)),
  );
  server.registerTool(
    "databases.create",
    {
      description:
        "Creates a database. Put objects in it with objects.create (database field).",
      inputSchema: z.object({
        slug: z.string().min(1),
        name: z.string().min(1),
        icon: z.string().optional(),
        description: z.string().optional(),
      }),
    },
    (input) => run(() => databasesService.create(ctx, input)),
  );
  server.registerTool(
    "databases.rename",
    {
      description:
        "Renames a database, and optionally its icon or description.",
      inputSchema: z.object({
        database: dbSlug,
        name: z.string().min(1).optional(),
        icon: z.string().optional(),
        description: z.string().optional(),
      }),
    },
    ({ database, ...patch }) =>
      run(async () =>
        databasesService.rename(ctx, (await getDatabase(database)).id, patch),
      ),
  );
  server.registerTool(
    "databases.delete",
    {
      description:
        "Deletes a database. Refused if it contains objects, unless confirm=true: objects and records are permanently deleted, in a single transaction (all or nothing). Export each object first (objects.export).",
      inputSchema: z.object({
        database: dbSlug,
        confirm: z.boolean().optional(),
      }),
    },
    ({ database, confirm }) =>
      run(async () =>
        databasesService.remove(ctx, (await getDatabase(database)).id, {
          confirm,
        }),
      ),
  );

  // Objects
  server.registerTool(
    "objects.list",
    {
      description:
        "Lists the workspace objects (record types) and their fields.",
    },
    () => run(() => objectsService.list(ctx)),
  );
  server.registerTool(
    "objects.get",
    {
      description: "Reads an object and its schema.",
      inputSchema: z.object({ object: slug }),
    },
    ({ object }) => run(() => getObject(ctx, object)),
  );
  server.registerTool(
    "objects.create",
    {
      description:
        "Creates an object. Field types: text, number, bool, date, select, multi_select, email, url, json, ref, refs, currency { currency?: 'EUR' }, percent (12.5 = 12.5%), phone, rating { scale?: 5 }, user, file (list of { key, name, size, type } returned by files.upload). Computed (input value ignored): formula { formula: 'amount * qty', result?: text|number|bool|date } recomputed on every write (operators + - * / % = != < > and or not, functions if, concat, round, abs, min, max, upper, lower, len, coalesce, empty, today, days_between); lookup { through, field } and rollup { through, op: count|sum|avg|min|max, field? } computed on read (through = ref/refs field, or slug of an object that points to this one); created_at, updated_at, created_by, autonumber. Per-field validation: required, pattern (regex), minLength, maxLength, min, max; default = value set on creation. `unique: true` (text, email, url, number, phone): unique value in the database, even under concurrent writes (two simultaneous webhooks for the same email -> a single record, or a conflict error without match); serves as the `match` key for records.upsert. Email compared in lowercase.",
      inputSchema: z.object({
        slug: z.string().min(1),
        name: z.string().min(1),
        icon: z.string().optional(),
        fields: z.array(fieldSchema),
        database: z
          .string()
          .optional()
          .describe("Database slug (default: the default database)"),
      }),
    },
    (input) => run(() => objectsService.create(ctx, input)),
  );
  server.registerTool(
    "objects.update_schema",
    {
      description:
        "Replaces an object's schema (fields), and optionally its name or icon. Same types as objects.create; an added or changed formula is recomputed on existing records.",
      inputSchema: z.object({
        object: slug,
        fields: z.array(fieldSchema).optional(),
        name: z.string().min(1).optional(),
        icon: z.string().optional(),
      }),
    },
    ({ object, ...patch }) =>
      run(async () =>
        objectsService.update(ctx, await objectId(ctx, object), patch),
      ),
  );
  server.registerTool(
    "objects.delete",
    {
      description:
        "Permanently deletes an object and all its records (trash included). Without confirm=true: refused, with the number of records at stake. Export first (objects.export).",
      inputSchema: z.object({ object: slug, confirm: z.boolean().optional() }),
    },
    ({ object, confirm }) =>
      run(async () =>
        objectsService.remove(ctx, await objectId(ctx, object), { confirm }),
      ),
  );
  server.registerTool(
    "objects.export",
    {
      description:
        "Exports all records of an object, 1000 per page, with no total limit. format csv (default, header on the 1st page) or json. Returns { csv | rows, next }; next page with after = next, until next = null.",
      inputSchema: z.object({
        object: slug,
        format: z.enum(["csv", "json"]).optional(),
        after: z.string().optional(),
      }),
    },
    ({ object, ...opts }) =>
      run(async () =>
        objectsService.export(ctx, await objectId(ctx, object), opts),
      ),
  );
  server.registerTool(
    "objects.index",
    {
      description:
        "Creates (if missing) an index on an object field to speed up frequent filters and sorts on large volumes. Does not block writes, idempotent. Returns { index, field }.",
      inputSchema: z.object({ object: slug, field: z.string() }),
    },
    ({ object, field }) =>
      run(async () =>
        objectsService.index(ctx, await objectId(ctx, object), field),
      ),
  );

  // Templates: runbase-template.json format, no id or secret.
  server.registerTool(
    "template.export",
    {
      description:
        "Exports the workspace as an runbase-template.json (versioned format): databases, objects and schema, saved views, functions, code components (TSX), workflows, pages, NAMES of the required secrets (never their values) and optional sample records. Workspace ids are replaced by local refs ($object:<slug>, $workflow:<key>, $record:<key>). Returns the template JSON.",
      inputSchema: z.object({
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        sampleRecords: z
          .number()
          .int()
          .min(0)
          .max(MAX_SAMPLE_RECORDS)
          .optional()
          .describe("sample records per object (default 0)"),
      }),
    },
    (opts) => run(() => templatesService.export(ctx, opts)),
  );
  server.registerTool(
    "template.import",
    {
      description:
        "Imports an runbase-template.json into the workspace (admin scope): creates databases, objects, views, records, functions, workflows (as draft), components and pages. Refused if an object, function or component of the same name exists. Invalid template: one error per problem with its path. Returns counts, created workflow and page ids, and missingSecrets to set (secrets.set) before activating workflows.",
      inputSchema: z.object({
        template: z
          .union([z.record(z.string(), z.unknown()), z.string()])
          .describe("the template object, or its JSON text"),
      }),
    },
    ({ template }) => run(() => templatesService.import(ctx, template)),
  );
  // Creator program: submission to the public catalog.
  server.registerTool(
    "templates.submit",
    {
      description:
        "Submits a template to the public Runbase catalog. Automatic validation first: description of at least 300 words with the sections ## Who it's for, ## The problem, ## What it does, ## Setup; valid runbase-template.json manifest (get it with template.export); author profile (pass `author` for a first template). Rejected: one clear error per problem. Accepted: opens a pull request for human review and returns its URL; the template is published on merge. No payment involved.",
      inputSchema: submissionSchema,
    },
    (input) => run(() => catalogService.submit(input)),
  );

  // Saved views
  const viewInput = {
    object: slug,
    name: z.string().min(1).describe("View name, unique per object"),
  };
  server.registerTool(
    "views.list",
    {
      description:
        "Lists an object's saved views (filter, sort, visible columns).",
      inputSchema: z.object({ object: slug }),
    },
    ({ object }) =>
      run(async () => viewsService.list(ctx, await objectId(ctx, object))),
  );
  server.registerTool(
    "views.get",
    {
      description: "Reads a saved view of an object.",
      inputSchema: z.object(viewInput),
    },
    ({ object, name }) =>
      run(async () => viewsService.get(ctx, await objectId(ctx, object), name)),
  );
  server.registerTool(
    "views.save",
    {
      description:
        'Creates or replaces a saved view of an object: filter (records.search DSL), sort and visible columns (field keys, in order). Visible in the object\'s table; a page uses it with a query { type: "records", object, view: <name> }.',
      inputSchema: z.object({
        ...viewInput,
        filter: filterSchema.optional(),
        sort: z
          .array(
            z.object({
              field: z.string(),
              dir: z.enum(["asc", "desc"]).optional(),
            }),
          )
          .optional(),
        columns: z.array(z.string()).optional(),
      }),
    },
    ({ object, ...input }) =>
      run(async () =>
        viewsService.save(ctx, await objectId(ctx, object), input),
      ),
  );
  server.registerTool(
    "views.delete",
    {
      description: "Deletes a saved view of an object.",
      inputSchema: z.object(viewInput),
    },
    ({ object, name }) =>
      run(async () =>
        viewsService.remove(ctx, await objectId(ctx, object), name),
      ),
  );
}
