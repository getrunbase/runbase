import { NextResponse, type NextRequest } from "next/server";
import {
  bodyMaxBytes,
  bucketOf,
  clientIp,
  ipRateLimit,
  tooLarge,
} from "@/lib/request-limits";

// Public routes (hooks, ingest, auth, MCP): per-IP limit before any
// authentication, 429 + Retry-After; declared body too large: 413 (the
// hooks/ingest routes also cap the streaming read).
async function guardApi(req: NextRequest) {
  const bucket = bucketOf(req.nextUrl.pathname);
  // Auth: only writes (sign-in, sign-up, tokens) are
  // limited, not the session read done on every page.
  if (!bucket || (bucket === "auth" && req.method === "GET")) return null;
  if (Number(req.headers.get("content-length") ?? 0) > bodyMaxBytes())
    return tooLarge();
  const r = await ipRateLimit(bucket, clientIp(req.headers));
  if (r.ok) return null;
  return Response.json(
    { error: `Too many requests: retry in ${r.retryAfter} s` },
    { status: 429, headers: { "Retry-After": String(r.retryAfter) } },
  );
}

// Pages reachable without a session (sign-in wall).
const PUBLIC_PAGES = ["/login", "/signup", "/reset-password"];

// Better Auth session cookie (__Secure- prefix over HTTPS). Read by hand:
// importing better-auth here loads a second copy of its types (tsc conflict).
const hasSessionCookie = (req: NextRequest) =>
  req.cookies.has("better-auth.session_token") ||
  req.cookies.has("__Secure-better-auth.session_token");

// Sign-in wall: without a session cookie, 307 to /login before any render.
// ponytail: optimistic check (cookie present); pages re-check the
// session (getTenant), so an expired cookie also ends up on /login.
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith("/api/"))
    return (await guardApi(req)) ?? NextResponse.next();
  if (
    PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    hasSessionCookie(req)
  )
    return NextResponse.next();
  const url = new URL("/login", req.url);
  if (pathname !== "/") url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url, 307);
}

// Node runtime (Redis via ioredis). Pages: everything except assets,
// iframe runtime (/c) and static files.
export const config = {
  runtime: "nodejs",
  matcher: [
    "/api/hooks/:path*",
    "/api/ingest/:path*",
    "/api/auth/:path*",
    "/api/mcp",
    "/api/mcp/:path*",
    "/((?!api/|_next/|c/|favicon\\.ico|robots\\.txt|opengraph-image|.*\\.[a-z0-9]+$).*)",
  ],
};
