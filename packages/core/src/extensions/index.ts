// Extension points: an overlay (managed hosting, etc.)
// plugs its implementations without forking the repo or putting its logic in
// the core. The core only depends on these interfaces; by default everything is
// no-op (no network call). Loading: RUNBASE_EXTENSIONS=<module>, at
// web (instrumentation) and worker startup.
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { appError } from "../errors/app-error";

export type TrackProps = Record<string, string | number | boolean | null>;

// Product analytics (usage events), distinct from the OTel metrics of
// ../telemetry (technical health).
export interface TelemetrySink {
  track(event: string, props?: TrackProps): void | Promise<void>;
}

// Entitlements of an organization: features (`feat:…`) and
// caps (`quota:…`). The core knows no plan name.
export type Entitlements = {
  features: string[];
  quotas: Record<string, number>;
};

// Billing: effective entitlements of an organization and metered usage reporting.
export interface BillingProvider {
  // null = no opinion: env caps, everything allowed.
  entitlements(organizationId: string): Promise<Entitlements | null>;
  reportUsage(workspaceId: string, metric: string, quantity: number): Promise<void>;
  // Optional: plan shown in Settings › Plan and usage.
  // Missing or null: the page does not appear (self-host).
  account?(organizationId: string): Promise<BillingAccount | null>;
  // Optional: plans offered in Settings › Plan and usage › Plans.
  // Missing, null or no plans: the page does not appear (self-host).
  // `locale` (e.g. "en", "fr"): language of the viewer, for the texts.
  plans?(
    organizationId: string,
    opts?: { locale?: string },
  ): Promise<BillingPlans | null>;
}

// Plan catalog provided by the extension. Prices in the smallest currency
// unit; checkoutUrl per billing interval, null when the plan cannot be
// chosen online (e.g. free plan).
export type BillingPlan = {
  id: string;
  name: string;
  description?: string | null;
  priceMonthlyCents: number;
  priceYearlyCents: number;
  currency: string;
  highlights: string[];
  checkoutUrl: { month: string; year: string } | null;
};

export type BillingPlans = {
  // Plan id of the organization, null when unknown.
  current: string | null;
  interval?: "month" | "year";
  plans: BillingPlan[];
  // Optional comparison table shown under the plan cards. Each row's values
  // are aligned with `plans` order; true/false render a check or a dash,
  // null an empty cell.
  comparison?: { rows: BillingComparisonRow[] };
};

export type BillingComparisonRow = { label: string; values: (string | boolean | null)[] };

// Plan name and links provided by the extension (no plan name or price
// in this repo). checkoutUrl: change plan; portalUrl: billing.
export type BillingAccount = {
  plan: string;
  checkoutUrl?: string | null;
  portalUrl?: string | null;
};

export type OAuthClient = { clientId: string; clientSecret: string };

// Credentials managed by the operator: OAuth client of a provider.
// null = nothing managed, the core keeps its configuration. Never an AI key:
// the platform does not provide AI.
export interface ManagedCredentials {
  oauthClient(provider: string): Promise<OAuthClient | null>;
}

// Script injected into the <head> of apps/web: external `src` or
// `inline`. Consent (e.g. GA4) is handled by the overlay script:
// the core knows nothing about it and injects nothing by default.
export type HeadScript = {
  id: string;
  src?: string;
  inline?: string;
  attrs?: Record<string, string>;
};

// Client extension point: head scripts of the web app.
export interface ClientExtension {
  headScripts(): Promise<HeadScript[]>;
}

// Inactivity policy: decides, per active workspace, whether to pause it or
// warn its owners first. The core applies the decision (pause, warnedAt) and
// resumes on next activity; the policy never resumes. Default: never pause.
export type InactivityInput = {
  workspaceId: string;
  organizationId: string;
  // Last activity, or creation date when none was recorded.
  lastActivityAt: string;
  paused: boolean;
  warnedAt: string | null;
  now: string;
};
export type InactivityDecision = { action: "pause" | "warn" | "none" };
export interface InactivityPolicy {
  decide(input: InactivityInput): Promise<InactivityDecision>;
}

export type Extensions = {
  telemetry: TelemetrySink;
  billing: BillingProvider;
  credentials: ManagedCredentials;
  client: ClientExtension;
  inactivity: InactivityPolicy;
};

export const defaultExtensions = (): Extensions => ({
  telemetry: { track() {} },
  billing: { entitlements: async () => null, reportUsage: async () => {} },
  credentials: { oauthClient: async () => null },
  client: { headScripts: async () => [] },
  inactivity: { decide: async () => ({ action: "none" }) },
});

// Methods expected per extension point (validation of a loaded module).
const SHAPE: { [K in keyof Extensions]: (keyof Extensions[K])[] } = {
  telemetry: ["track"],
  billing: ["entitlements", "reportUsage"],
  credentials: ["oauthClient"],
  client: ["headScripts"],
  inactivity: ["decide"],
};

// Global registry: Next loads instrumentation and routes in separate
// bundles, the shared symbol keeps a single registry per process.
const KEY = Symbol.for("runbase.extensions");
const store = globalThis as { [KEY]?: Extensions };

export const getExtensions = (): Extensions => (store[KEY] ??= defaultExtensions());

export function registerExtensions(ext: Partial<Extensions>) {
  store[KEY] = { ...getExtensions(), ...validate(ext, "registerExtensions") };
}

// Tests: back to the default implementations.
export function resetExtensions() {
  delete store[KEY];
}

const invalid = (module: string, reason: string) =>
  appError(
    "extensions.invalid",
    "Invalid extension module {module}: {reason}",
    { module, reason },
  );

function validate(ext: unknown, module: string): Partial<Extensions> {
  if (!ext || typeof ext !== "object")
    throw invalid(module, "expected an object with telemetry, billing, credentials, client or inactivity");
  const out: Partial<Extensions> = {};
  for (const [key, impl] of Object.entries(ext)) {
    if (!(key in SHAPE)) throw invalid(module, `unknown extension point "${key}"`);
    for (const m of SHAPE[key as keyof Extensions])
      if (typeof (impl as Record<string, unknown> | null)?.[m as string] !== "function")
        throw invalid(module, `${key}.${String(m)} must be a function`);
    (out as Record<string, unknown>)[key] = impl;
  }
  return out;
}

// Relative/absolute path -> file URL; otherwise package name.
const specifier = (spec: string) =>
  spec.startsWith(".") || isAbsolute(spec)
    ? pathToFileURL(resolve(process.cwd(), spec)).href
    : spec;

const notFoundCode = (e: unknown) => {
  const c = (e as { code?: string } | null)?.code;
  return c === "ERR_MODULE_NOT_FOUND" || c === "MODULE_NOT_FOUND";
};

// Loads the designated module (default export or `extensions`, object or
// function returning it). No module configured or not found: silent
// no-op. Malformed module: explicit AppError. Returns true if loaded.
export async function loadExtensions(
  spec = process.env.RUNBASE_EXTENSIONS,
): Promise<boolean> {
  if (!spec?.trim()) return false;
  const url = specifier(spec.trim());
  let mod: Record<string, unknown>;
  try {
    mod = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);
  } catch (e) {
    // Only the absence of the module itself is silent: a missing
    // dependency inside the module stays an error.
    if (notFoundCode(e) && String((e as Error).message).includes(spec.trim().replace(/^\.\//, "")))
      return false;
    throw e;
  }
  let ext = mod.default ?? mod.extensions;
  if (typeof ext === "function") ext = await (ext as () => unknown)();
  registerExtensions(validate(ext, spec));
  return true;
}

// Best-effort send: a failing analytics sink never breaks
// the caller (error logged, never propagated).
export async function track(event: string, props?: TrackProps) {
  try {
    await getExtensions().telemetry.track(event, props);
  } catch (err) {
    const { logger } = await import("../logger");
    logger.warn({ err, event }, "extension telemetry failed");
  }
}
