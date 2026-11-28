// Errors that a new attempt cannot fix: configuration and authorization
// problems (missing secret or connection, domain not allowed, HTTP 4xx
// except 408/429). The engine fails the step at once instead of retrying.
import { ZodError } from "zod";
import { AppError } from "../errors/app-error";

// Thrown by a block (or wrapping a cause) to skip the retry policy.
export class NonRetryable extends Error {}

const CONFIG_CODES = new Set([
  "blocks.unknownSecret",
  "blocks.domainNotAllowed",
  "connections.missing",
  "connections.notFound",
  "workflows.missingSecret",
]);

// Validation errors (missing field, no match, invalid value or schema):
// the same input fails the same way on every attempt.
const VALIDATION_CODE =
  /\.(?:[a-zA-Z]*(?:Required|Mismatch|NoMatch|Invalid[A-Za-z]*)|invalid[A-Z][a-zA-Z]*|invalid|[a-zA-Z]*Schema[A-Za-z]*)$/;

const clientStatus = (s: unknown) =>
  typeof s === "number" && s >= 400 && s < 500 && s !== 408 && s !== 429;

export function isNonRetryable(e: unknown): boolean {
  if (e instanceof NonRetryable || e instanceof ZodError) return true;
  if (e instanceof AppError) {
    if (CONFIG_CODES.has(e.code) || VALIDATION_CODE.test(e.code)) return true;
    if (e.kind === "unauthorized" || e.kind === "forbidden") return true;
    return clientStatus(e.params.status);
  }
  return clientStatus((e as { status?: unknown } | null)?.status);
}
