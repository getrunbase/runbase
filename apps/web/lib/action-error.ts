// Server action -> client: an error does not cross the boundary as an
// instance; we return a serializable item {code, params, message},
// translated at render time by useErrorText.
//   } catch (e) { return { error: actionError(e) }; }
import { toErrorItem, type ErrorItem } from "@runbase/core/app-error";

export type ActionError = ErrorItem;
export const actionError = (e: unknown): ActionError => toErrorItem(e);
