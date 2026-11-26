// First-touch signup attribution (UTM, click IDs). Stored in a first-party
// cookie on the first visit carrying one of these params, then added to
// `user.signed_up`. The core stores nothing and calls no vendor: what to do
// with it is an extension's job. Any site on the parent domain may set the
// same cookie (URL-encoded JSON object, keys below).

export const ATTRIBUTION_COOKIE = "runbase_attribution";
export const ATTRIBUTION_MAX_AGE = 30 * 24 * 3600;

export const ATTRIBUTION_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "ref",
  "gclid",
  "fbclid",
  "twclid",
  "li_fat_id",
  "msclkid",
] as const;

const MAX_VALUE = 200;

type Attribution = Record<string, string>;

// Allowlisted keys only, string values trimmed and truncated.
const clean = (get: (k: string) => unknown): Attribution => {
  const out: Attribution = {};
  for (const k of ATTRIBUTION_KEYS) {
    const v = get(k);
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, MAX_VALUE);
  }
  return out;
};

/** Attribution params of a URL query, or null when there is none. */
export const attributionFromQuery = (params: URLSearchParams) => {
  const a = clean((k) => params.get(k));
  return Object.keys(a).length ? a : null;
};

/** Cookie value for an attribution. */
export const encodeAttribution = (a: Attribution) =>
  encodeURIComponent(JSON.stringify(a));

/** Attribution read from a raw cookie value; {} when absent or malformed. */
export const decodeAttribution = (raw: string | null | undefined): Attribution => {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(decodeURIComponent(raw));
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return clean((k) => (v as Record<string, unknown>)[k]);
  } catch {
    return {};
  }
};

/** Attribution from a `Cookie` request header. */
export const attributionFromCookieHeader = (header: string | null | undefined) => {
  const m = header?.match(new RegExp(`(?:^|;\\s*)${ATTRIBUTION_COOKIE}=([^;]*)`));
  return decodeAttribution(m?.[1]);
};
