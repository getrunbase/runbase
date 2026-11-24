// Page capture token (page.screenshot): short HMAC (120 s) bound to the
// workspace, the user (or the API key) and the page. Sent as a header by the headless
// browser; only opens reading of that page (getTenant flags it,
// mutation actions refuse it).
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { appError } from "@runbase/core/errors";
import { env } from "@runbase/core/env";

export const SHOT_HEADER = "x-screenshot-token";
// Covers the wait in the renderer queue then the capture (15 s max).
const TTL_MS = 120_000;

// App origin seen by the renderer (separate service in production:
// RENDERER_APP_URL=http://web:3000); in dev, the local Next server.
export const appUrl = () =>
  env().RENDERER_APP_URL ?? `http://127.0.0.1:${env().PORT}`;

// Issued for a user (`user`) or an API key (`key`).
export type ShotClaims = {
  ws: string;
  user?: string;
  key?: string;
  page: string;
  exp: number;
};

const secret = () => {
  const s = env().BETTER_AUTH_SECRET;
  if (!s)
    throw appError("platform.missingSecret", "{name} missing", {
      name: "BETTER_AUTH_SECRET",
    });
  return s;
};
const sign = (body: string) =>
  createHmac("sha256", `${secret()}:screenshot`)
    .update(body)
    .digest("base64url");

export function shotToken(c: Omit<ShotClaims, "exp">, now = Date.now()) {
  const body = Buffer.from(
    JSON.stringify({ ...c, exp: now + TTL_MS, n: randomUUID() }),
  ).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyShotToken(
  token: string | null | undefined,
  now = Date.now(),
): ShotClaims | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const want = Buffer.from(sign(body));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const c = JSON.parse(
      Buffer.from(body, "base64url").toString(),
    ) as ShotClaims;
    return typeof c.exp === "number" && c.exp > now ? c : null;
  } catch {
    return null;
  }
}
