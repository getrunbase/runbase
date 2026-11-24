// Reference examples served by page.examples: multi-file TSX page
// packages built on the @getrunbase/kit blocks. Each one provides `files`,
// `entry`, `permissions` and mock `data` (fictional CRM from example-data).
import { seed } from "./example-data";

const crmIndex = String.raw`import { useState } from "react";
import { DataTable } from "@getrunbase/kit";
import { DealPanel } from "./components/deal-panel";

// Slug of the mock data. Live: the object uuid (objects.get).
const DEALS = "deals";

export default function Deals() {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Deals</h1>
        <p className="text-sm text-muted-foreground">Select a deal to see and edit its details.</p>
      </header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label="Deal list" className="min-w-0">
          <DataTable
            object={DEALS}
            fields={["name", "stage", "amount", "owner", "close_date"]}
            searchable
            onRowClick={(row) => setSelected(row.id)}
          />
        </section>
        <DealPanel object={DEALS} recordId={selected} onClose={() => setSelected(null)} />
      </div>
    </main>
  );
}
`;

const crmPanel = String.raw`import { RecordDetail, RecordForm } from "@getrunbase/kit";
import { Button } from "@ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@ui/card";
import { X } from "lucide-react";

const FIELDS = ["name", "stage", "amount", "owner", "close_date", "company"];

// No selection: create form. Selection: detail, then edit form.
export function DealPanel({
  object,
  recordId,
  onClose,
}: {
  object: string;
  recordId: string | null;
  onClose: () => void;
}) {
  return (
    <aside aria-label="Deal panel">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">{recordId ? "Deal" : "New deal"}</CardTitle>
          {recordId && (
            <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
              <X className="size-4" />
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {recordId && <RecordDetail object={object} recordId={recordId} fields={FIELDS} />}
          <RecordForm key={recordId ?? "new"} object={object} recordId={recordId ?? undefined} fields={FIELDS} />
        </CardContent>
      </Card>
    </aside>
  );
}
`;

const kanbanIndex = String.raw`import { useState } from "react";
import { FilterBar, Kanban, type FilterValue } from "@getrunbase/kit";
import { PageHeader } from "./components/page-header";

const DEALS = "deals";

export default function Pipeline() {
  const [value, setValue] = useState<FilterValue>({});
  return (
    <main className="flex min-h-0 flex-col gap-4 p-4 md:p-6">
      <PageHeader title="Pipeline" subtitle="Drag a card to change its stage." />
      <FilterBar object={DEALS} fields={["stage"]} onChange={setValue} />
      <div className="min-w-0 overflow-x-auto">
        <Kanban object={DEALS} groupBy="stage" subtitleField="amount" filter={value.filter} />
      </div>
    </main>
  );
}
`;

const pageHeader = String.raw`export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
    </header>
  );
}
`;

const dashIndex = String.raw`import { Kpis } from "./components/kpis";
import { Charts } from "./components/charts";

const DEALS = "deals";

export default function SalesDashboard() {
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Sales</h1>
        <p className="text-sm text-muted-foreground">Pipeline and results, updated live.</p>
      </header>
      <Kpis object={DEALS} />
      <Charts object={DEALS} />
    </main>
  );
}
`;

const dashKpis = String.raw`import { KpiCard } from "@getrunbase/kit";

const OPEN = { field: "stage", op: "in", value: ["lead", "qualified", "proposal", "negotiation"] };
const WON = { field: "stage", op: "eq", value: "won" };

export function Kpis({ object }: { object: string }) {
  return (
    <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard object={object} title="Deals" />
      <KpiCard object={object} op="sum" field="amount" filter={OPEN} title="Open pipeline" format="currency" />
      <KpiCard object={object} op="sum" field="amount" filter={WON} title="Won" format="currency" />
      <KpiCard object={object} op="avg" field="amount" title="Average deal" format="currency" />
    </section>
  );
}
`;

const dashCharts = String.raw`import { ChartCard } from "@getrunbase/kit";

export function Charts({ object }: { object: string }) {
  return (
    <section aria-label="Charts" className="grid gap-4 lg:grid-cols-3">
      <div className="min-w-0 lg:col-span-2">
        <ChartCard object={object} groupBy="stage" op="sum" field="amount" title="Pipeline by stage" format="currency" />
      </div>
      <ChartCard object={object} groupBy="owner" kind="pie" title="Deals by owner" />
    </section>
  );
}
`;

const data = seed();
const perms = (objects: string[], write: string[] = []) => ({
  objects,
  write,
  workflows: [],
  files: false,
  ai: false,
});

export type PageExample = {
  name: string;
  description: string;
  entry: string;
  files: Record<string, string>;
  permissions: ReturnType<typeof perms>;
  data: ReturnType<typeof seed>;
};

export const EXAMPLES: PageExample[] = [
  {
    name: "crm",
    description:
      "CRM deals page: searchable DataTable, side panel with RecordDetail and RecordForm (create when nothing is selected, edit otherwise). Two files.",
    entry: "index.tsx",
    files: { "index.tsx": crmIndex, "components/deal-panel.tsx": crmPanel },
    permissions: perms(["deals", "companies"], ["deals"]),
    data,
  },
  {
    name: "kanban",
    description:
      "Pipeline kanban: FilterBar on the stage field driving a Kanban grouped by stage (drag and drop writes the stage). Shared header component.",
    entry: "index.tsx",
    files: {
      "index.tsx": kanbanIndex,
      "components/page-header.tsx": pageHeader,
    },
    permissions: perms(["deals"], ["deals"]),
    data,
  },
  {
    name: "dashboard",
    description:
      "Sales dashboard: four KpiCard (count, open pipeline, won, average) and two ChartCard (bar by stage, pie by owner), aggregated server-side.",
    entry: "index.tsx",
    files: {
      "index.tsx": dashIndex,
      "components/kpis.tsx": dashKpis,
      "components/charts.tsx": dashCharts,
    },
    permissions: perms(["deals"]),
    data,
  },
];
