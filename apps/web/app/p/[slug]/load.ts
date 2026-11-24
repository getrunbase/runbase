import { notFound } from "next/navigation";
import { AppError } from "@getrunbase/core/errors";

// Missing page (null or not_found error): 404. Any other error (database,
// permissions…) is logged then rethrown: never hidden as a 404.
export async function pageOr404<T>(load: Promise<T | null>): Promise<T> {
  let page: T | null;
  try {
    page = await load;
  } catch (e) {
    if (e instanceof AppError && e.kind === "not_found") notFound();
    console.error("page load failed", e);
    throw e;
  }
  if (!page) notFound();
  return page;
}
