// Server action -> client: an error does not cross the boundary as an
// instance; we return a serializable item {code, params, message},
// translated at render time by useErrorText.
//   } catch (e) { return { error: actionError(e) }; }
// or, preferred: return runAction(async () => { ... });
import { unstable_rethrow } from "next/navigation";
import {
  AppError,
  toErrorItem,
  type ErrorItem,
} from "@getrunbase/core/app-error";

export type ActionError = ErrorItem;
export const actionError = (e: unknown): ActionError => toErrorItem(e);

export type ActionResult<T = void> = { data?: T; error?: ActionError };

// Runs a server action body and returns its expected errors (AppError:
// permission, quota, validation via parseInput) as a value: a thrown
// error renders the generic error page. Next control flow (redirect,
// notFound) is rethrown; any other error is a bug and is rethrown too
// (Next hides its message from the client in production).
export async function runAction<T>(
  fn: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    return { data: await fn() };
  } catch (e) {
    unstable_rethrow(e);
    if (!(e instanceof AppError)) throw e;
    return { error: actionError(e) };
  }
}
