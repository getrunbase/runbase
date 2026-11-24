// postMessage bridge between the page (parent) and the runtime iframe of
// code components: dedicated runtime origin, message origin
// filter and SDK call cap. No server dependency (client and route).
import { appError } from "@runbase/core/app-error";

// Dedicated runtime origin (e.g. https://runtime.example.com; in dev
// http://127.0.0.1:7100 when the app runs on localhost). Empty: same
// origin as the app (sandboxed iframe anyway, opaque origin).
export const runtimeOrigin = () =>
  (process.env.NEXT_PUBLIC_RUNTIME_ORIGIN ?? "").replace(/\/+$/, "");

export const runtimeSrc = () => `${runtimeOrigin()}/c/runtime`;

// Origins accepted for iframe messages: "null" (sandbox without
// allow-same-origin, opaque origin) or the runtime origin. Any other
// origin (another window, iframe navigated elsewhere) is ignored.
export function acceptOrigin(origin: string, runtime = runtimeOrigin()) {
  return origin === "null" || (!!runtime && origin === runtime);
}

// Sliding cap over 1 s (per page block).
export function limiter(max: number, now: () => number = Date.now) {
  const times: number[] = [];
  return () => {
    const t = now();
    while (times.length && t - times[0]! > 1000) times.shift();
    if (times.length >= max) return false;
    times.push(t);
    return true;
  };
}

export const MAX_CALLS_PER_SEC = 20;
export const MAX_WRITES_PER_SEC = 5;
const WRITES = ["create", "update", "delete", "upload", "ai"];

// Guard for a block's SDK calls: null if the call goes through, otherwise the
// sdk.rateLimited error to send back to the iframe.
export function sdkGuard(now: () => number = Date.now) {
  const calls = limiter(MAX_CALLS_PER_SEC, now);
  const writes = limiter(MAX_WRITES_PER_SEC, now);
  return (method: unknown) => {
    if (!calls())
      return appError(
        "sdk.rateLimited",
        "Too many SDK calls: at most {max} per second",
        { max: MAX_CALLS_PER_SEC },
      );
    if (WRITES.includes(String(method)) && !writes())
      return appError(
        "sdk.rateLimited",
        "Too many SDK calls: at most {max} per second",
        { max: MAX_WRITES_PER_SEC },
      );
    return null;
  };
}
