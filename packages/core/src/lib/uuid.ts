// Central identifier guard: a non-uuid id must never
// reach Postgres (22P02 error wrapped by Drizzle, with SQL and
// parameters in the message).
import { appError } from "../errors/app-error";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (id: unknown): id is string =>
  typeof id === "string" && UUID.test(id);

// Malformed id: displayable error, without SQL.
export function assertUuid(id: unknown): asserts id is string {
  if (!isUuid(id))
    throw appError(
      "common.invalidId",
      "Invalid id: {id}",
      { id: String(id).slice(0, 64) },
      { kind: "invalid_input" },
    );
}

// Postgres error of class 22 (invalid data: 22P02 malformed uuid/text,
// 22007 date, 22003 number out of range…), direct or wrapped by Drizzle
// (`cause`). Returns the SQLSTATE code, otherwise undefined.
export function dataException(e: unknown): string | undefined {
  for (let c: unknown = e, i = 0; c && i < 3; i++) {
    const code = (c as { code?: unknown }).code;
    if (typeof code === "string" && /^22[0-9A-Z]{3}$/.test(code)) return code;
    c = (c as { cause?: unknown }).cause;
  }
  return undefined;
}

// Global safety net: Postgres invalid-data error -> generic error, without
// the query text or its parameters (workspace_id…). Any other error
// is returned as is.
export function mapDbError(e: unknown): unknown {
  if (!dataException(e)) return e;
  // Name the offending value from the Postgres message (`invalid input
  // syntax for type uuid: "abc"`): it is the caller's own argument.
  for (let c: unknown = e, i = 0; c && i < 3; i++) {
    const msg = (c as { message?: unknown }).message;
    const m =
      typeof msg === "string"
        ? /invalid input (?:syntax|value) for (?:type )?(\w+): "([^"]*)"/.exec(
            msg,
          )
        : null;
    if (m)
      return appError(
        "common.invalidValueOf",
        "Invalid {type} value: “{value}”. Check the id or field passed with that value.",
        { type: m[1]!, value: m[2]!.slice(0, 64) },
        { kind: "invalid_input" },
      );
    c = (c as { cause?: unknown }).cause;
  }
  return appError(
    "common.invalidValue",
    "Invalid value: an id or a field value is malformed",
    {},
    { kind: "invalid_input" },
  );
}
