// Displayable error, no dependency (importable client-side through
// `@getrunbase/core/app-error`).
// - `code`: stable translation identifier (`records.notFound`). The web
//   translates it through apps/web/messages/fr/errors/*.json, otherwise shows `message`.
// - `params`: template values (`{id}`), reused by the translation.
// - `message`: English text rendered from the inline template (MCP, logs).
// - `kind`: machine category read by MCP agents (`[not_found] …`).
// - `items`: detail of a composite error (workflow validation…).

export type ErrorParams = Record<string, string | number>;

// Code + params passed to subclasses (QuotaError…).
export type ErrorInfo = { code: string; params?: ErrorParams };

// A serializable error item (validation, dry-run reason, action).
export type ErrorItem = {
  code: string;
  params: ErrorParams;
  message: string;
  // Detail of a composite error, translatable item by item.
  items?: ErrorItem[];
};

export type ErrorKind =
  | "error"
  | "not_found"
  | "confirm_required"
  | "conflict"
  | "invalid_input"
  | "not_waiting"
  | "quota_exceeded"
  | "unauthorized"
  | "forbidden"
  | "invalid_workflow"
  | (string & {});

// "Record {id} not found" + { id: "42" } -> "Record 42 not found".
// A missing parameter leaves `{name}` as is.
export const renderTemplate = (template: string, params: ErrorParams = {}) =>
  template.replace(/\{(\w+)\}/g, (m, k: string) =>
    k in params ? String(params[k]) : m,
  );

export const errorItem = (
  code: string,
  template: string,
  params: ErrorParams = {},
): ErrorItem => ({ code, params, message: renderTemplate(template, params) });

export class AppError extends Error {
  readonly kind: ErrorKind;
  readonly items: ErrorItem[];
  constructor(
    readonly code: string,
    message: string,
    readonly params: ErrorParams = {},
    opts: { kind?: ErrorKind; items?: ErrorItem[] } = {},
  ) {
    super(message);
    this.kind = opts.kind ?? "error";
    this.items = opts.items ?? [];
  }
  toItem(): ErrorItem {
    return {
      code: this.code,
      params: this.params,
      message: this.message,
      ...(this.items.length && { items: this.items }),
    };
  }
}

// Main API: throw appError("records.notFound", "Record {id} not found", { id }).
export const appError = (
  code: string,
  template: string,
  params: ErrorParams = {},
  opts: { kind?: ErrorKind; items?: ErrorItem[] } = {},
) => new AppError(code, renderTemplate(template, params), params, opts);

// Missing target (kind `not_found`): say what, which id, how to find the right one.
export const notFound = (
  code: string,
  template: string,
  params: ErrorParams = {},
) => appError(code, template, params, { kind: "not_found" });

// Authentication refused (HTTP 401) / access refused (HTTP 403).
export const unauthorized = (
  code: string,
  template: string,
  params: ErrorParams = {},
) => appError(code, template, params, { kind: "unauthorized" });
export const forbidden = (
  code: string,
  template: string,
  params: ErrorParams = {},
) => appError(code, template, params, { kind: "forbidden" });

// HTTP status of an authentication error (kind unauthorized/forbidden).
export function authStatus(e: unknown): 401 | 403 | undefined {
  if (!(e instanceof AppError)) return undefined;
  if (e.kind === "unauthorized") return 401;
  if (e.kind === "forbidden") return 403;
  return undefined;
}

// Bulk or cascading destructive operation: `confirm: true` required.
export function requireConfirm(
  confirm: boolean | undefined,
  code: string,
  template: string,
  params: ErrorParams = {},
) {
  if (confirm !== true)
    throw appError(
      code,
      `${template}: irreversible operation, retry with confirm: true.`,
      params,
      { kind: "confirm_required" },
    );
}

// Any error -> serializable item (server action -> client). A non-AppError
// error keeps its message, with an untranslated generic code.
export function toErrorItem(e: unknown): ErrorItem {
  if (e instanceof AppError) return e.toItem();
  const c = (e as { code?: unknown; params?: unknown } | null) ?? {};
  const message = e instanceof Error ? e.message : String(e);
  return typeof c.code === "string" && c.code.includes(".")
    ? { code: c.code, params: (c.params as ErrorParams) ?? {}, message }
    : { code: "error", params: {}, message };
}
