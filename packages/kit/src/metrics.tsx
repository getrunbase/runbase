/** @jsxRuntime automatic */
// Metrics: KpiCard (one aggregation) and ChartCard (grouped aggregation,
// recharts). Computed server side by useAggregate.
import { Bar, BarChart, CartesianGrid, Line, LineChart, Pie, PieChart, XAxis, YAxis } from "recharts";
import type { Aggregation, Filter } from "@getrunbase/sdk";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@ui/chart";
import { sdk } from "./sdk";
import { BlockState, type Labels } from "./state";
import { cellText } from "./table";

type Metric = {
  object: string;
  op?: Aggregation["op"];
  // Aggregated field (not needed for count).
  field?: string;
  filter?: Filter;
  title: string;
  description?: string;
  // Value format: number (default), currency (+ currency), percent.
  format?: "number" | "currency" | "percent";
  currency?: string;
  labels?: Labels;
  locale?: string;
};

const fmt = (v: unknown, m: Metric) =>
  m.format === "percent"
    ? new Intl.NumberFormat(m.locale, { style: "percent", maximumFractionDigits: 1 }).format(Number(v) / 100)
    : cellText(
        v,
        m.format === "currency"
          ? { key: "", label: "", type: "currency", format: m.currency ?? "EUR" }
          : { key: "", label: "", type: "number", format: "0" },
        { locale: m.locale },
      );

export type KpiCardProps = Metric;

// KPI: one aggregated value (count, sum, avg, min, max) over the filtered object.
export function KpiCard(p: KpiCardProps) {
  const res = sdk().useAggregate<{ value?: number }>({
    object: p.object,
    filter: p.filter,
    aggregate: [{ op: p.op ?? "count", ...(p.field && { field: p.field }), as: "value" }],
  });
  const value = res.data[0]?.value ?? 0;
  return (
    <Card data-kit="kpi-card">
      <CardHeader>
        <CardDescription>{p.title}</CardDescription>
        <BlockState loading={res.loading && !res.data.length} error={res.error} labels={p.labels}>
          <CardTitle className="text-2xl tabular-nums">{fmt(value, p)}</CardTitle>
        </BlockState>
        {p.description && <CardDescription>{p.description}</CardDescription>}
      </CardHeader>
    </Card>
  );
}

export type ChartCardProps = Metric & {
  // Grouping field (X axis, pie slices).
  groupBy: string;
  kind?: "bar" | "line" | "pie";
  height?: number;
};

// Chart: aggregation by value of `groupBy`.
export function ChartCard(p: ChartCardProps) {
  const res = sdk().useAggregate<Record<string, unknown>>({
    object: p.object,
    filter: p.filter,
    groupBy: p.groupBy,
    aggregate: [{ op: p.op ?? "count", ...(p.field && { field: p.field }), as: "value" }],
  });
  const data = res.data.map((r) => ({ name: String(r[p.groupBy] ?? ""), value: Number(r.value ?? 0) }));
  const config: ChartConfig = { value: { label: p.title, color: "var(--chart-1)" } };
  const kind = p.kind ?? "bar";
  return (
    <Card data-kit="chart-card">
      <CardHeader>
        <CardTitle>{p.title}</CardTitle>
        {p.description && <CardDescription>{p.description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <BlockState loading={res.loading && !data.length} error={res.error} empty={!data.length} labels={p.labels}>
          <ChartContainer config={config} style={{ height: p.height ?? 240 }} className="w-full">
            {kind === "pie" ? (
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent />} />
                <Pie data={data} dataKey="value" nameKey="name" fill="var(--color-value)" />
              </PieChart>
            ) : kind === "line" ? (
              <LineChart data={data}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={48} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line dataKey="value" stroke="var(--color-value)" strokeWidth={2} dot={false} />
              </LineChart>
            ) : (
              <BarChart data={data}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={48} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="value" fill="var(--color-value)" radius={4} />
              </BarChart>
            )}
          </ChartContainer>
        </BlockState>
      </CardContent>
    </Card>
  );
}
