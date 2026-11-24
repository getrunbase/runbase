// API v1: shared HTTP adapter. Auth + limit, zod validation of params,
// query and body (schemas from endpoints.ts), errors as stable JSON
// `{ code, message, params }`. The logic stays in the core services.
import { z } from "zod";
import { appError, AppError, notFound } from "@runbase/core/errors";
import { objectsService } from "@runbase/core/objects";
import type { TenantContext } from "@runbase/core/tenant";
import { authenticate, limitKey, type RateHeaders } from "./auth";
import { endpoints, type Endpoint, type Endpoints } from "./endpoints";

const STATUS: Record<string, number> = {
  not_found: 404,
  invalid_input: 400,
  confirm_required: 400,
  invalid_workflow: 400,
  conflict: 409,
  not_waiting: 409,
  quota_exceeded: 429,
  unauthorized: 401,
  forbidden: 403,
};

const issues = (e: z.ZodError) =>
  e.issues
    .map((i) =>
      i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message,
    )
    .join("; ");

// Any error -> JSON response. A business error (`domain.name` code) is a
// client error (400 by default); the rest is a 500 without internal details.
export function errorResponse(e: unknown): Response {
  if (e instanceof z.ZodError)
    e = appError(
      "api.invalidRequest",
      "Invalid request: {issues}",
      { issues: issues(e) },
      { kind: "invalid_input" },
    );
  const headers = (e as { headers?: RateHeaders }).headers;
  if (e instanceof AppError) {
    const status =
      (e as { status?: number }).status ??
      STATUS[e.kind] ??
      (e.code.includes(".") ? 400 : 500);
    return Response.json(e.toItem(), { status, headers });
  }
  console.error("[api/v1]", e);
  return Response.json(appError("api.internal", "Internal error").toItem(), {
    status: 500,
  });
}

// Object by slug or id, 404 if it is missing from the workspace.
export async function objectOf(ctx: TenantContext, object: string) {
  const row = await objectsService.get(ctx, object);
  if (!row) throw notFound("objects.notFound", "Object not found");
  return row;
}

type Out<T> = T extends z.ZodType ? z.output<T> : undefined;
type Input<E extends Endpoint> = {
  ctx: TenantContext;
  req: Request;
  params: Out<E["params"]>;
  query: Out<E["query"]>;
  body: Out<E extends { multipart: z.ZodType } ? E["multipart"] : E["body"]>;
};

const parse = <T extends z.ZodType | undefined>(schema: T, value: unknown) =>
  (schema ? schema.parse(value) : undefined) as Out<T>;

async function readBody(e: Endpoint, req: Request) {
  if (e.multipart) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw appError(
        "api.invalidMultipart",
        "Invalid body: multipart/form-data expected",
        {},
        { kind: "invalid_input" },
      );
    }
    return e.multipart.parse(Object.fromEntries(form));
  }
  if (!e.body) return undefined;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw appError(
      "api.invalidJson",
      "Invalid body: JSON expected",
      {},
      { kind: "invalid_input" },
    );
  }
  return e.body.parse(raw);
}

// HTTP cache of public endpoints: CDN 5 min, then background revalidation.
export const PUBLIC_CACHE =
  "public, max-age=60, s-maxage=300, stale-while-revalidate=86400";

// Public endpoint (catalog): no tenant, same limiter as API keys
// (15.6), counted per client IP address.
async function publicAccess(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const headers = await limitKey(`ip:${ip}`);
  return {
    ctx: undefined as unknown as TenantContext,
    headers: { ...headers, "cache-control": PUBLIC_CACHE },
  };
}

// Next handler of an endpoint. `impl` returns the JSON value (endpoint
// status) or a full Response (variable status, binary).
export function route<K extends keyof Endpoints>(
  name: K,
  impl: (input: Input<Endpoints[K]>) => Promise<unknown>,
) {
  const e: Endpoint = endpoints[name];
  return async (
    req: Request,
    { params }: { params: Promise<Record<string, string>> },
  ) => {
    try {
      const { ctx, headers } = e.public
        ? await publicAccess(req)
        : await authenticate(req);
      const raw = await params;
      let p;
      try {
        p = parse(e.params, raw);
      } catch (err) {
        const param = String((err as z.ZodError).issues?.[0]?.path[0] ?? "id");
        throw appError(
          "api.invalidParam",
          "Invalid path parameter {param}: {value}",
          { param, value: raw[param] ?? "" },
          { kind: "invalid_input" },
        );
      }
      const query = parse(
        e.query,
        Object.fromEntries(new URL(req.url).searchParams),
      );
      const body = await readBody(e, req);
      const out = await impl({ ctx, req, params: p, query, body } as Input<
        Endpoints[K]
      >);
      if (out instanceof Response) {
        for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
        return out;
      }
      if (e.status === 204) return new Response(null, { status: 204, headers });
      return Response.json(out, { status: e.status, headers });
    } catch (err) {
      return errorResponse(err);
    }
  };
}
