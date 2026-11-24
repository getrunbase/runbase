// Anonymous telemetry, on by default: one ping per day to
// RUNBASE_TELEMETRY_URL (otherwise the project receiver).
// Payload: random instance id, version, OS/arch, bucketed counters.
// No PII or tenant content. RUNBASE_TELEMETRY=0 turns everything off. A failure
// (network, database) is ignored: telemetry never affects the worker.
import { arch, platform } from "node:os";
import { instanceCounts, instanceId } from "@runbase/core/instance";

export const TELEMETRY_INTERVAL_MS = 24 * 3_600_000;

// Project receiver (runbase-cloud, POST /v1/telemetry).
export const DEFAULT_TELEMETRY_URL =
  "https://telemetry.getrunbase.com/v1/telemetry";

export const telemetryUrl = (env: Env) =>
  env.RUNBASE_TELEMETRY_URL || DEFAULT_TELEMETRY_URL;

// Buckets: the exact value never leaves the instance.
export function bucket(n: number): string {
  if (n <= 0) return "0";
  for (const max of [10, 100, 1_000, 10_000, 100_000])
    if (n < max) return `<${max}`;
  return "100000+";
}

type Counts = { workspaces: number; workflows: number; runs: number };

export function buildPayload(i: {
  id: string;
  version: string;
  counts: Counts;
}) {
  return {
    instanceId: i.id,
    version: i.version,
    os: platform(),
    arch: arch(),
    node: process.versions.node,
    workspaces: bucket(i.counts.workspaces),
    workflows: bucket(i.counts.workflows),
    runs: bucket(i.counts.runs),
  };
}

type Env = Record<string, string | undefined>;
type Deps = {
  env?: Env;
  fetch?: typeof fetch;
  id?: () => Promise<string>;
  counts?: () => Promise<Counts>;
  log?: { info: (msg: string) => void };
};

export const telemetryEnabled = (env: Env) => env.RUNBASE_TELEMETRY !== "0";

// One ping; never throws. Returns true if the request succeeded.
export async function sendPing(d: Deps = {}): Promise<boolean> {
  const env = d.env ?? process.env;
  if (!telemetryEnabled(env)) return false;
  try {
    const [id, counts] = await Promise.all([
      (d.id ?? instanceId)(),
      (d.counts ?? instanceCounts)(),
    ]);
    const res = await (d.fetch ?? fetch)(telemetryUrl(env), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        buildPayload({ id, version: env.APP_VERSION ?? "dev", counts }),
      ),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Startup: info log, immediate ping then daily.
export function startTelemetry(d: Deps = {}) {
  const env = d.env ?? process.env;
  const off = { stop: () => {} };
  if (env.RUNBASE_TELEMETRY === "0") {
    d.log?.info("anonymous telemetry disabled (RUNBASE_TELEMETRY=0)");
    return off;
  }
  d.log?.info(
    "anonymous telemetry enabled: one daily ping (random instance id, version, OS/arch, bucketed counts; no personal data). Set RUNBASE_TELEMETRY=0 to disable. See docs/self-hosting.md",
  );
  void sendPing(d);
  const timer = setInterval(() => void sendPing(d), TELEMETRY_INTERVAL_MS);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
