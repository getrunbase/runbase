import { connectionsService } from "@getrunbase/core/connections";
import { toErrorItem } from "@getrunbase/core/errors";
import { logger } from "@getrunbase/core/logger";
import { getTenant } from "@/lib/tenant";

// OAuth redirect URI of connector connections: exchanges the code with the
// session of the user who started the flow, then back to the settings.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (q: Record<string, string>) =>
    Response.redirect(
      new URL(`/settings/connections?${new URLSearchParams(q)}`, url),
      303,
    );
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  // Consent refused or provider error.
  if (!code || !state)
    return back({ error: url.searchParams.get("error") ?? "missing_code" });
  try {
    const { ctx } = await getTenant();
    const { name } = await connectionsService.complete(ctx, state, code);
    return back({ connected: name });
  } catch (e) {
    logger.warn({ err: e }, "oauth connection failed");
    return back({ error: toErrorItem(e).message });
  }
}
