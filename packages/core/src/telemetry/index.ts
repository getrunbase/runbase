// OpenTelemetry metrics. No-op by default: nothing is measured or
// exported until startMetrics() has started a MeterProvider
// (OTEL_METRICS_EXPORTER=otlp|console). Metrics:
//   http.server.request.duration  latency per route (histogram: p95), web
//   runbase.queue.depth           pending jobs per queue and per workspace
//   runbase.queue.oldest_age      age of the oldest pending job (s)
//   runbase.pg.pool.connections   pool connections by state (busy, idle)
//   runbase.pg.pool.waiting       queries waiting for a connection
//   runbase.pg.pool.max           max pool size (saturation = busy / max)
//   runbase.ai.cost               AI cost (USD) per workspace
import {
  metrics,
  trace,
  type Attributes,
  type Counter,
  type Histogram,
} from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ConsoleMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
} from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  type ReadableSpan,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type postgres from "postgres";
import { env } from "../env";

let instruments: { httpDuration: Histogram; aiCost: Counter } | undefined;

// Observed pools and queues: registered even without export (zero cost).
const pools = new Map<string, postgres.Sql>();
type QueueLike = {
  name: string;
  getJobs(
    types: ("waiting" | "delayed" | "prioritized")[],
    start: number,
    end: number,
  ): Promise<({ timestamp: number; data: unknown } | undefined)[]>;
};
const queues = new Set<QueueLike>();
export const observePool = (name: string, sql: postgres.Sql) =>
  void pools.set(name, sql);
export const observeQueue = (queue: QueueLike) => void queues.add(queue);

// Bounded sample: beyond that, the depth is a minimum.
const QUEUE_SAMPLE = 1000;

async function sampleQueue(q: QueueLike) {
  const jobs = await q.getJobs(
    ["waiting", "delayed", "prioritized"],
    0,
    QUEUE_SAMPLE - 1,
  );
  const by = new Map<string, { depth: number; oldest: number }>();
  for (const j of jobs) {
    if (!j) continue;
    const ws =
      (j.data as { workspaceId?: string } | null)?.workspaceId ?? "unknown";
    const s = by.get(ws) ?? { depth: 0, oldest: j.timestamp };
    s.depth++;
    s.oldest = Math.min(s.oldest, j.timestamp);
    by.set(ws, s);
  }
  return by;
}

export function recordAiCost(workspaceId: string, usd: number) {
  if (usd > 0) instruments?.aiCost.add(usd, { workspace_id: workspaceId });
}

export function recordRequest(r: {
  route: string;
  method?: string;
  status?: number;
  seconds: number;
}) {
  const a: Attributes = { "http.route": r.route };
  if (r.method) a["http.request.method"] = r.method;
  if (r.status) a["http.response.status_code"] = r.status;
  instruments?.httpDuration.record(r.seconds, a);
}

export const HTTP_BUCKETS_S = [
  0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10,
];

// Next server spans (BaseServer.handleRequest): http.route set by Next.
export const routeLatencyProcessor: SpanProcessor = {
  onStart() {},
  onEnd(span: ReadableSpan) {
    const route =
      span.attributes["http.route"] ?? span.attributes["next.route"];
    if (typeof route !== "string") return;
    const [s, ns] = span.duration;
    recordRequest({
      route,
      method: span.attributes["http.method"] as string | undefined,
      status: Number(span.attributes["http.status_code"]) || undefined,
      seconds: s + ns / 1e9,
    });
  },
  forceFlush: async () => {},
  shutdown: async () => {},
};

function exporterFromEnv(): PushMetricExporter | undefined {
  const e = env();
  if (e.OTEL_METRICS_EXPORTER === "console") return new ConsoleMetricExporter();
  if (e.OTEL_METRICS_EXPORTER === "otlp")
    return new OTLPMetricExporter({
      url: `${e.OTEL_EXPORTER_OTLP_ENDPOINT!.replace(/\/$/, "")}/v1/metrics`,
    });
  return undefined;
}

export function startMetrics(
  service: string,
  opts: {
    exporter?: PushMetricExporter;
    routes?: boolean;
    intervalMs?: number;
  } = {},
) {
  const exporter = opts.exporter ?? exporterFromEnv();
  if (!exporter) return undefined;
  const provider = new MeterProvider({
    resource: resourceFromAttributes({
      "service.name": env().OTEL_SERVICE_NAME ?? service,
    }),
    readers: [
      new PeriodicExportingMetricReader({
        exporter,
        exportIntervalMillis:
          opts.intervalMs ?? env().OTEL_METRIC_EXPORT_INTERVAL,
      }),
    ],
  });
  metrics.setGlobalMeterProvider(provider);
  const meter = provider.getMeter("runbase");
  instruments = {
    httpDuration: meter.createHistogram("http.server.request.duration", {
      unit: "s",
      description: "HTTP request latency by route",
      // Buckets in seconds (OTel HTTP conventions): the SDK default buckets
      // are in ms and would put every request in (0, 5], without p95.
      advice: { explicitBucketBoundaries: HTTP_BUCKETS_S },
    }),
    aiCost: meter.createCounter("runbase.ai.cost", {
      unit: "USD",
      description: "AI cost by workspace",
    }),
  };
  const conns = meter.createObservableGauge("runbase.pg.pool.connections", {
    description: "Postgres pool connections by state",
  });
  const waiting = meter.createObservableGauge("runbase.pg.pool.waiting", {
    description: "Queries waiting for a pool connection",
  });
  const max = meter.createObservableGauge("runbase.pg.pool.max", {
    description: "Postgres pool size",
  });
  meter.addBatchObservableCallback(
    (o) => {
      for (const [pool, sql] of pools) {
        const s = sql.stats;
        o.observe(conns, s.connections - s.idle, { pool, state: "busy" });
        o.observe(conns, s.idle, { pool, state: "idle" });
        o.observe(waiting, s.waiting, { pool });
        o.observe(max, sql.options.max, { pool });
      }
    },
    [conns, waiting, max],
  );
  const depth = meter.createObservableGauge("runbase.queue.depth", {
    description: "Waiting jobs by queue and workspace",
  });
  const age = meter.createObservableGauge("runbase.queue.oldest_age", {
    unit: "s",
    description: "Age of the oldest waiting job by queue and workspace",
  });
  meter.addBatchObservableCallback(
    async (o) => {
      const now = Date.now();
      for (const q of queues) {
        const by = await sampleQueue(q).catch(
          () => new Map<string, { depth: number; oldest: number }>(),
        );
        for (const [ws, s] of by) {
          const a = { queue: q.name, workspace_id: ws };
          o.observe(depth, s.depth, a);
          o.observe(age, (now - s.oldest) / 1000, a);
        }
      }
    },
    [depth, age],
  );
  if (opts.routes)
    trace.setGlobalTracerProvider(
      new BasicTracerProvider({ spanProcessors: [routeLatencyProcessor] }),
    );
  return {
    provider,
    shutdown: async () => {
      instruments = undefined;
      await provider.shutdown();
      metrics.disable();
      if (opts.routes) trace.disable();
    },
  };
}
