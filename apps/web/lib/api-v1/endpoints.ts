// REST API v1: each endpoint is declared only once here, with
// its zod schemas. They are used both to validate requests (lib/api-v1/http)
// and to generate the OpenAPI spec (lib/api-v1/openapi): nothing written by hand.
import { z } from "zod";
import { RUN_STATUSES } from "@getrunbase/core/runs";

// Named schemas: exposed as components/schemas in the spec.
export const registry = z.registry<{ id: string }>();
const named = <T extends z.ZodType>(id: string, schema: T) => {
  registry.add(schema, { id });
  return schema;
};

const uuid = z.uuid();
const datetime = z.iso.datetime({ offset: true });
const json = z.record(z.string(), z.unknown());

export const ErrorSchema = named(
  "Error",
  z.object({
    code: z.string().describe("Stable error code, e.g. records.notFound"),
    message: z.string().describe("English message"),
    params: z.record(z.string(), z.union([z.string(), z.number()])),
  }),
);

const ObjectSchema = named(
  "Object",
  z.looseObject({
    id: uuid,
    databaseId: uuid,
    slug: z.string(),
    name: z.string(),
    icon: z.string().nullable(),
    fields: z.array(json).describe("Typed fields of the object"),
    createdAt: datetime,
    updatedAt: datetime,
  }),
);

const RecordSchema = named(
  "Record",
  z.looseObject({
    id: uuid,
    objectId: uuid,
    externalId: z.string().nullable(),
    data: json,
    isTest: z.boolean(),
    createdAt: datetime,
    updatedAt: datetime,
  }),
);

const RunSchema = named(
  "Run",
  z.looseObject({
    id: uuid,
    workflowId: uuid,
    version: z.int(),
    recordId: uuid.nullable(),
    status: z.enum(RUN_STATUSES),
    currentStep: z.string().nullable(),
    error: z.string().nullable(),
    isTest: z.boolean(),
    createdAt: datetime,
    finishedAt: datetime.nullable(),
  }),
);

const EventSchema = named(
  "Event",
  z.looseObject({
    id: uuid,
    recordId: uuid.nullable(),
    type: z.string(),
    payload: json,
    occurredAt: datetime,
    source: z.string().nullable(),
    idempotencyKey: z.string().nullable(),
    isTest: z.boolean(),
    createdAt: datetime,
  }),
);

const FileSchema = named(
  "File",
  z.object({
    key: z.string().describe("Value to store in a file field"),
    name: z.string(),
    size: z.int(),
    type: z.string(),
  }),
);

// Keyset pagination: `after` = `next` of the previous page.
const pageQuery = {
  limit: z.coerce.number().int().min(1).max(200).optional(),
  after: uuid.optional().describe("Cursor: `next` of the previous page"),
};
const page = <T extends z.ZodType>(item: T) =>
  z.object({
    data: z.array(item),
    next: uuid.nullable().describe("Cursor of the next page, null at the end"),
  });

const objectParam = z.object({
  object: z.string().min(1).describe("Object slug or id"),
});
const idParam = z.object({ id: uuid });

// Public catalog, served under /api/catalog without an API key.
const slugParam = z.string().regex(/^[a-z0-9-]+$/);
const TemplateSummarySchema = named(
  "CatalogTemplateSummary",
  z.object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    excerpt: z.string().describe("Plain-text start of the description"),
    categories: z.array(z.string()),
    connectors: z
      .array(z.string())
      .describe("Connector slugs, derived from the manifest"),
    authorId: z.string().describe("GitHub login of the creator"),
    createdAt: z.iso.date(),
    updatedAt: z.iso.date(),
  }),
);
const CatalogTemplateSchema = named(
  "CatalogTemplate",
  TemplateSummarySchema.omit({ excerpt: true }).extend({
    description: z
      .string()
      .describe("Markdown: who it's for, problem, what it does, setup"),
    manifest: json.describe("runbase-template.json manifest"),
  }),
);
const operation = z.object({ name: z.string(), description: z.string() });
const CatalogConnectorSchema = named(
  "CatalogConnector",
  z.object({
    slug: z.string(),
    displayName: z.string(),
    icon: z.string(),
    description: z.string(),
    categories: z.array(z.string()),
    triggers: z.array(operation),
    actions: z.array(operation),
    docsUrl: z.string(),
    credentialType: z.enum(["oauth2", "apiKey", "basic", "none"]),
  }),
);
const CreatorSchema = named(
  "CatalogCreator",
  z.object({
    username: z.string().describe("GitHub login"),
    name: z.string(),
    bio: z.string(),
    avatar: z.string(),
    links: z.array(z.object({ label: z.string(), url: z.string() })),
    templates: z.array(TemplateSummarySchema),
  }),
);

export type Endpoint = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  tag: "objects" | "records" | "runs" | "events" | "files" | "catalog";
  // Public endpoint (catalog): no key, limited per IP, served
  // under /api/catalog instead of /api/v1.
  public?: true;
  summary: string;
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  // multipart/form-data body (upload) instead of JSON.
  multipart?: z.ZodObject;
  status: 200 | 201 | 204;
  response?: z.ZodType;
  // Binary response (download) instead of JSON.
  binary?: true;
};

export const endpoints = {
  listObjects: {
    method: "GET",
    path: "/objects",
    tag: "objects",
    summary: "List the objects of the workspace",
    status: 200,
    response: z.object({ data: z.array(ObjectSchema) }),
  },
  getObject: {
    method: "GET",
    path: "/objects/{object}",
    tag: "objects",
    summary: "Get an object and its fields",
    params: objectParam,
    status: 200,
    response: ObjectSchema,
  },
  listRecords: {
    method: "GET",
    path: "/objects/{object}/records",
    tag: "records",
    summary: "List the records of an object (keyset pagination)",
    params: objectParam,
    query: z.object({
      ...pageQuery,
      q: z.string().optional().describe("Free text search"),
    }),
    status: 200,
    response: page(RecordSchema).extend({
      total: z.int().describe("Records matching the query"),
    }),
  },
  createRecord: {
    method: "POST",
    path: "/objects/{object}/records",
    tag: "records",
    summary:
      "Create or update a record (upsert on externalId or a unique field)",
    params: objectParam,
    body: z.object({
      data: json,
      externalId: z.string().min(1).optional(),
      match: z
        .string()
        .optional()
        .describe("Unique field used as upsert key, e.g. email"),
      mode: z.enum(["merge", "replace"]).optional(),
      test: z.boolean().optional(),
    }),
    status: 201,
    response: z.object({ record: RecordSchema, created: z.boolean() }),
  },
  getRecord: {
    method: "GET",
    path: "/records/{id}",
    tag: "records",
    summary: "Get a record with its resolved references",
    params: idParam,
    status: 200,
    response: RecordSchema,
  },
  updateRecord: {
    method: "PATCH",
    path: "/records/{id}",
    tag: "records",
    summary: "Update a record (merge by default)",
    params: idParam,
    body: z.object({
      data: json,
      mode: z.enum(["merge", "replace"]).optional(),
    }),
    status: 200,
    response: RecordSchema,
  },
  deleteRecord: {
    method: "DELETE",
    path: "/records/{id}",
    tag: "records",
    summary: "Move a record to the trash",
    params: idParam,
    status: 204,
  },
  listRuns: {
    method: "GET",
    path: "/runs",
    tag: "runs",
    summary: "List workflow runs, most recent first (keyset pagination)",
    query: z.object({
      ...pageQuery,
      workflowId: uuid.optional(),
      recordId: uuid.optional(),
      status: z.enum(RUN_STATUSES).optional(),
    }),
    status: 200,
    response: page(RunSchema),
  },
  startRun: {
    method: "POST",
    path: "/runs",
    tag: "runs",
    summary: "Start a workflow run",
    body: z.object({
      workflowId: uuid,
      recordId: uuid.optional(),
      event: z.unknown().optional().describe("Payload available as {{event}}"),
      idempotencyKey: z.string().min(1).optional(),
      test: z.boolean().optional(),
    }),
    status: 201,
    response: RunSchema,
  },
  getRun: {
    method: "GET",
    path: "/runs/{id}",
    tag: "runs",
    summary: "Get a run with its steps",
    params: idParam,
    status: 200,
    response: RunSchema.extend({ steps: z.array(json) }),
  },
  listEvents: {
    method: "GET",
    path: "/events",
    tag: "events",
    summary: "List events, most recent first (keyset pagination)",
    query: z.object({
      ...pageQuery,
      type: z.string().optional(),
      recordId: uuid.optional(),
    }),
    status: 200,
    response: page(EventSchema),
  },
  pushEvent: {
    method: "POST",
    path: "/events",
    tag: "events",
    summary: "Push an event (deduplicated by idempotencyKey)",
    body: z.object({
      type: z.string().min(1),
      recordId: uuid.optional(),
      payload: json.optional(),
      occurredAt: datetime.optional(),
      idempotencyKey: z.string().min(1).optional(),
      test: z.boolean().optional(),
    }),
    status: 201,
    response: EventSchema.extend({ duplicate: z.boolean() }),
  },
  uploadFile: {
    method: "POST",
    path: "/files",
    tag: "files",
    summary: "Upload a file (10 MB max)",
    multipart: z.object({ file: z.file() }),
    status: 201,
    response: FileSchema,
  },
  downloadFile: {
    method: "GET",
    path: "/files/content",
    tag: "files",
    summary: "Download a file by its key",
    query: z.object({ key: z.string().min(1) }),
    status: 200,
    binary: true,
  },
  listCatalogTemplates: {
    method: "GET",
    path: "/templates",
    tag: "catalog",
    public: true,
    summary: "Search the public template catalog (keyset pagination)",
    query: z.object({
      q: z.string().optional().describe("Full text search"),
      category: z.string().optional(),
      connector: slugParam.optional().describe("Connector slug"),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      after: slugParam
        .optional()
        .describe("Cursor: `next` of the previous page"),
    }),
    status: 200,
    response: z.object({
      data: z.array(TemplateSummarySchema),
      next: z
        .string()
        .nullable()
        .describe("Cursor of the next page, null at the end"),
      total: z.int().describe("Templates matching the query"),
    }),
  },
  getCatalogTemplate: {
    method: "GET",
    path: "/templates/{id}",
    tag: "catalog",
    public: true,
    summary: "Get a catalog template by id or slug",
    params: z.object({ id: slugParam.describe("Template id or slug") }),
    status: 200,
    response: CatalogTemplateSchema,
  },
  listCatalogConnectors: {
    method: "GET",
    path: "/connectors",
    tag: "catalog",
    public: true,
    summary: "List the connectors of the catalog",
    query: z.object({ category: z.string().optional() }),
    status: 200,
    response: z.object({ data: z.array(CatalogConnectorSchema) }),
  },
  getCatalogConnector: {
    method: "GET",
    path: "/connectors/{slug}",
    tag: "catalog",
    public: true,
    summary: "Get a connector and the templates that use it",
    params: z.object({ slug: slugParam }),
    status: 200,
    response: CatalogConnectorSchema.extend({
      templates: z.array(TemplateSummarySchema),
    }),
  },
  getCatalogCreator: {
    method: "GET",
    path: "/creators/{username}",
    tag: "catalog",
    public: true,
    summary: "Get a creator profile and their templates",
    params: z.object({ username: z.string().regex(/^[A-Za-z0-9-]{1,39}$/) }),
    status: 200,
    response: CreatorSchema,
  },
} as const satisfies Record<string, Endpoint>;

export type Endpoints = typeof endpoints;
