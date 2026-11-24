// OTel metrics: no-op by default; with OTLP, the metrics
// reach a test backend (local HTTP server receiving OTLP JSON).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type postgres from "postgres";
import { trace } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  type Histogram,
} from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import {
  HTTP_BUCKETS_S,
  observePool,
  observeQueue,
  recordAiCost,
  routeLatencyProcessor,
  startMetrics,
} from "./index";

test("metrics: no export by default", () => {
  delete process.env.OTEL_METRICS_EXPORTER;
  assert.equal(startMetrics("test"), undefined);
  // Without a provider, registration does nothing and does not throw.
  recordAiCost("ws", 1);
});

test("metrics: OTLP export to a test backend", async () => {
  const bodies: string[] = [];
  const server = createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      if (req.url === "/v1/metrics") bodies.push(b);
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  process.env.OTEL_METRICS_EXPORTER = "otlp";
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${port}`;
  try {
    const m = startMetrics("runbase-test", { intervalMs: 60_000 })!;
    assert.ok(m);
    observePool("main", {
      stats: { connections: 4, opening: 0, idle: 1, leased: 0, waiting: 2 },
      options: { max: 10 },
    } as unknown as postgres.Sql);
    const now = Date.now();
    observeQueue({
      name: "runs",
      getJobs: async () => [
        { timestamp: now - 30_000, data: { workspaceId: "ws-a" } },
        { timestamp: now - 5_000, data: { workspaceId: "ws-a" } },
        { timestamp: now, data: { workspaceId: "ws-b" } },
      ],
    });
    recordAiCost("ws-a", 0.25);
    recordAiCost("ws-a", 0.5);
    routeLatencyProcessor.onEnd({
      attributes: {
        "http.route": "/api/v1/records",
        "http.method": "GET",
        "http.status_code": 200,
      },
      duration: [0, 120_000_000],
    } as unknown as ReadableSpan);
    await m.provider.forceFlush();
    await m.shutdown();

    const metrics = bodies
      .map((b) => JSON.parse(b))
      .flatMap((p) => p.resourceMetrics)
      .flatMap((r: { scopeMetrics: { metrics: unknown[] }[] }) =>
        r.scopeMetrics.flatMap((s) => s.metrics),
      ) as {
      name: string;
      sum?: { dataPoints: Point[] };
      gauge?: { dataPoints: Point[] };
      histogram?: { dataPoints: Point[] };
    }[];
    type Point = {
      asDouble?: number;
      asInt?: number | string;
      count?: number | string;
      attributes: { key: string; value: { stringValue?: string } }[];
    };
    const points = (name: string) => {
      const x = metrics.find((y) => y.name === name);
      assert.ok(x, `metric ${name} exported`);
      return (x.sum ?? x.gauge ?? x.histogram)!.dataPoints;
    };
    const attr = (p: Point, k: string) =>
      p.attributes.find((a) => a.key === k)?.value.stringValue;
    const val = (p: Point) => Number(p.asDouble ?? p.asInt);

    const [cost] = points("runbase.ai.cost");
    assert.equal(attr(cost!, "workspace_id"), "ws-a");
    assert.equal(val(cost!), 0.75);

    const [req] = points("http.server.request.duration");
    assert.equal(attr(req!, "http.route"), "/api/v1/records");
    assert.equal(Number(req!.count), 1);

    const busy = points("runbase.pg.pool.connections").find(
      (p) => attr(p, "state") === "busy",
    );
    assert.equal(val(busy!), 3);
    assert.equal(val(points("runbase.pg.pool.max")[0]!), 10);
    assert.equal(val(points("runbase.pg.pool.waiting")[0]!), 2);

    const depth = points("runbase.queue.depth");
    const a = depth.find((p) => attr(p, "workspace_id") === "ws-a")!;
    assert.equal(val(a), 2);
    assert.equal(attr(a, "queue"), "runs");
    const age = points("runbase.queue.oldest_age").find(
      (p) => attr(p, "workspace_id") === "ws-a",
    )!;
    assert.ok(val(age) >= 30 && val(age) < 60);
  } finally {
    delete process.env.OTEL_METRICS_EXPORTER;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    server.close();
  }
});

test("HTTP latency: buckets in seconds, p95 computable per route", async () => {
  const exporter = new InMemoryMetricExporter(
    AggregationTemporality.CUMULATIVE,
  );
  const m = startMetrics("test", {
    exporter,
    intervalMs: 60_000,
    routes: true,
  });
  try {
    // A trace provider registered later (e.g. an APM SDK) does not replace
    // the route metrics one: the OTel API keeps the first.
    trace.setGlobalTracerProvider(new BasicTracerProvider());
    for (const s of [0.05, 0.1, 0.2, 0.3, 1.2]) {
      const span = trace.getTracer("t").startSpan("GET /x", {
        attributes: { "http.route": "/x" },
        startTime: [1000, 0],
      });
      span.end([1000 + Math.floor(s), Math.round((s % 1) * 1e9)]);
    }
    await m!.provider.forceFlush();
    const metric = exporter
      .getMetrics()
      .flatMap((r) => r.scopeMetrics.flatMap((x) => x.metrics))
      .find((x) => x.descriptor.name === "http.server.request.duration")!;
    const point = metric.dataPoints[0]!.value as Histogram;
    assert.deepEqual(point.buckets.boundaries, HTTP_BUCKETS_S);
    assert.equal(point.count, 5);
    // One request per bucket, none piled into the first one anymore.
    const at = (b: number) => point.buckets.counts[HTTP_BUCKETS_S.indexOf(b)];
    assert.equal(point.buckets.counts[0], 0);
    assert.equal(at(0.05), 1);
    assert.equal(at(0.1), 1);
    assert.equal(at(0.25), 1);
    assert.equal(at(0.5), 1);
    assert.equal(at(2.5), 1);
  } finally {
    await m!.shutdown();
  }
});
