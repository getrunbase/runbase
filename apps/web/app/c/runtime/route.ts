// Code components runtime page, loaded in <iframe sandbox="allow-scripts">.
// Static (no data): the bundle and the data arrive through postMessage.
// With NEXT_PUBLIC_RUNTIME_ORIGIN, served only on that dedicated origin
// (404 on the app origin) and frameable only by the app.
import { runtimeCsp, runtimeHtml } from "@/lib/code-runtime";
import { runtimeOrigin } from "@/lib/runtime-bridge";

export const runtime = "nodejs";

const originOf = (u: string | undefined) => {
  try {
    return u ? new URL(u).origin : null;
  } catch {
    return null;
  }
};

// Origins allowed to frame the runtime: the app and the renderer.
function ancestors() {
  const app = originOf(process.env.BETTER_AUTH_URL) ?? "http://localhost:7100";
  const renderer =
    originOf(process.env.RENDERER_APP_URL) ??
    `http://127.0.0.1:${process.env.PORT ?? 7100}`;
  return [...new Set([app, renderer])];
}

export async function GET(req: Request) {
  const dedicated = runtimeOrigin();
  if (dedicated) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (host !== new URL(dedicated).host)
      return new Response("not found", { status: 404 });
  }
  return new Response(await runtimeHtml(), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": runtimeCsp(
        dedicated ? ancestors() : undefined,
      ),
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": "private, max-age=300",
    },
  });
}
