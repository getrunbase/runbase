// API v1 OpenAPI 3.1 spec, generated from the zod schemas of endpoints.ts
// (zod's native JSON Schema 2020-12). No part is written by hand.
import { z } from "zod";
import { endpoints, ErrorSchema, registry, type Endpoint } from "./endpoints";

type Json = Record<string, unknown>;

export function openapi() {
  const defs: Json = {};
  const schema = (s: z.ZodType, io: "input" | "output"): Json => {
    const { $schema, $defs, ...rest } = z.toJSONSchema(s, {
      metadata: registry,
      target: "draft-2020-12",
      unrepresentable: "any",
      io,
    }) as Json;
    void $schema;
    Object.assign(defs, $defs);
    return rest;
  };
  const errorRef = { $ref: "#/components/schemas/Error" };
  schema(ErrorSchema, "output");
  const error = (description: string) => ({
    description,
    content: { "application/json": { schema: errorRef } },
  });

  const paths: Record<string, Json> = {};
  for (const [operationId, raw] of Object.entries(endpoints)) {
    const e: Endpoint = raw;
    const parameters = [
      ...(["params", "query"] as const).flatMap((where) =>
        Object.entries(e[where]?.shape ?? {}).map(([name, s]) => ({
          name,
          in: where === "params" ? "path" : "query",
          required: where === "params" || !s.safeParse(undefined).success,
          schema: schema(s as z.ZodType, "input"),
        })),
      ),
      ...(e.public
        ? []
        : [
            {
              name: "x-workspace-id",
              in: "header",
              required: false,
              description: "Workspace of the API key (default: its first one)",
              schema: { type: "string", format: "uuid" },
            },
          ]),
    ];
    const body = e.multipart ?? e.body;
    const ok =
      e.status === 204
        ? { description: "No content" }
        : {
            description: "Success",
            content: e.binary
              ? {
                  "application/octet-stream": {
                    schema: {
                      type: "string",
                      contentMediaType: "application/octet-stream",
                    },
                  },
                }
              : {
                  "application/json": {
                    schema: schema(e.response ?? z.unknown(), "output"),
                  },
                },
          };
    // Public catalog: served under /api/catalog, without an API key.
    const key = e.public ? `/catalog${e.path}` : e.path;
    paths[key] = {
      ...paths[key],
      ...(e.public && { servers: [{ url: "/api" }] }),
      [e.method.toLowerCase()]: {
        operationId,
        tags: [e.tag],
        summary: e.summary,
        parameters,
        ...(e.public && { security: [] }),
        ...(body && {
          requestBody: {
            required: true,
            content: {
              [e.multipart ? "multipart/form-data" : "application/json"]: {
                schema: schema(body, "input"),
              },
            },
          },
        }),
        responses: {
          [e.status]: ok,
          400: error("Invalid request or path parameter"),
          ...(!e.public && {
            401: error("Missing or invalid API key"),
            403: error("Scope or workspace not allowed"),
          }),
          ...((e.params || e.binary) && { 404: error("Not found") }),
          429: error("Rate limit exceeded (see Retry-After)"),
        },
      },
    };
  }

  const doc = {
    openapi: "3.1.0",
    info: {
      title: "Runbase API",
      version: "1.0.0",
      description:
        "REST API v1. Authenticate with an API key: `Authorization: Bearer agk_…`. Lists use keyset pagination: pass `next` as `after`. Errors are `{ code, message, params }`.",
    },
    servers: [{ url: "/api/v1" }],
    security: [{ apiKey: [] }],
    tags: ["objects", "records", "runs", "events", "files", "catalog"].map(
      (name) => ({
        name,
      }),
    ),
    paths,
    components: {
      securitySchemes: { apiKey: { type: "http", scheme: "bearer" } },
      schemas: defs,
    },
  };
  // zod references ($defs) -> OpenAPI components.
  return JSON.parse(
    JSON.stringify(doc).replaceAll('"#/$defs/', '"#/components/schemas/'),
  ) as Json;
}
