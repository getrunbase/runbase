// Server variant (server components, route handlers) of useErrorText.
import { getLocale } from "next-intl/server";
import { errorText } from "./error-text";

export async function getErrorText() {
  const locale = await getLocale();
  return (e: unknown) => errorText(e, locale);
}
