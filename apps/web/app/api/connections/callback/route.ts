import { connectionsService } from "@getrunbase/core/connections";
import { toErrorItem } from "@getrunbase/core/errors";
import { logger } from "@getrunbase/core/logger";
import { getTenant } from "@/lib/tenant";

// OAuth redirect URI of connector connections: exchanges the code with the
// session of the user who started the flow, then back to the settings.
// Popup (workflow editor): hands the result to the opener and closes.
const popupDone = (data: Record<string, string>) =>
  new Response(
    `<!doctype html><script>opener&&opener.postMessage(${JSON.stringify({
      type: "runbase.connection",
      ...data,
    }).replace(/</g, "\\u003c")},location.origin);close()</script>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );

export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (q: Record<string, string>) =>
    Response.redirect(
      new URL(`/settings/connections?${new URLSearchParams(q)}`, url),
      303,
    );
  // Error with no trusted popup flag: a small page that reports to the
  // opener when there is one, else goes back to the settings.
  const popupOrBack = (error: string) =>
    new Response(
      `<!doctype html><script>if(opener){opener.postMessage(${JSON.stringify({
        type: "runbase.connection",
        error,
      }).replace(
        /</g,
        "\\u003c",
      )},location.origin);close()}else location.replace(${JSON.stringify(
        `/settings/connections?${new URLSearchParams({ error })}`,
      ).replace(/</g, "\\u003c")})</script>`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  // Consent refused or provider error.
  if (!code || !state) {
    const error = url.searchParams.get("error") ?? "missing_code";
    // Popup unknown without a valid state: try the opener, else the page.
    return url.searchParams.get("state") ? popupOrBack(error) : back({ error });
  }
  try {
    const { ctx } = await getTenant();
    const { name, popup } = await connectionsService.complete(ctx, state, code);
    return popup ? popupDone({ name }) : back({ connected: name });
  } catch (e) {
    logger.warn({ err: e }, "oauth connection failed");
    return popupOrBack(toErrorItem(e).message);
  }
}
