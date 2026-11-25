// Docs languages in the URL: English without prefix (/docs/x), French
// under /docs/fr/x. Pages are rendered under app/[lang]: rewrite to the
// internal path, redirect /docs/en/x to /docs/x (see lib/locale-path.mjs).
import { NextResponse, type NextRequest } from "next/server";
import { route } from "./lib/locale-path.mjs";

export function proxy(request: NextRequest) {
  const target = route(request.nextUrl.pathname);
  if (!target) return NextResponse.next();
  const url = request.nextUrl.clone();
  if ("redirect" in target) {
    url.pathname = target.redirect;
    return NextResponse.redirect(url, 308);
  }
  url.pathname = target.rewrite;
  return NextResponse.rewrite(url);
}

// Not for Next assets, route handlers (search, OG images) and files
// (sitemap.xml, llms.txt, icon.svg).
export const config = {
  matcher: ["/((?!_next/|docs/_next/|docs/api/|docs/og/|.*\\.[a-z0-9]+$).*)"],
};
