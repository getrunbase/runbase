// One example page per block (TSX source of a page package), on the fictional
// CRM of the examples (companies and deals objects). Compiled and rendered by
// the runtime tests (apps/web/components/code-runtime/kit.test.ts).
export type KitExample = {
  block: string;
  source: string;
  // Minimal permissions of the page.
  permissions: { objects: string[]; write?: string[]; files?: boolean };
  // Text expected in the server render.
  expect: string;
};

const page = (imports: string, body: string) =>
  `import { ${imports} } from "@getrunbase/kit";\n\nexport default function Page() {\n  return (\n    ${body}\n  );\n}\n`;

const read = { objects: ["deals", "companies"] };
const COMPANY_1 = "00000000-0000-4000-8000-630000000001";
const DEAL_1 = "00000000-0000-4000-8000-640000000001";

export const KIT_EXAMPLES: KitExample[] = [
  {
    block: "DataTable",
    source: page("DataTable", `<DataTable object="deals" fields={["name", "stage", "amount"]} />`),
    permissions: read,
    expect: "Stage",
  },
  {
    block: "Kanban",
    source: page("Kanban", `<Kanban object="deals" groupBy="stage" subtitleField="amount" />`),
    permissions: { ...read, write: ["deals"] },
    expect: "negotiation",
  },
  {
    block: "Calendar",
    source: page("Calendar", `<Calendar object="deals" dateField="close_date" />`),
    permissions: read,
    expect: 'data-kit="calendar"',
  },
  {
    block: "Timeline",
    source: page("Timeline", `<Timeline recordId="${COMPANY_1}" />`),
    permissions: read,
    expect: "Scoping workshop",
  },
  {
    block: "Gallery",
    source: page("Gallery", `<Gallery object="companies" fields={["city", "industry"]} />`),
    permissions: read,
    expect: "Aurora Energy",
  },
  {
    block: "RecordForm",
    source: page(
      "RecordForm",
      `<RecordForm object="deals" recordId="${DEAL_1}" fields={["name", "stage", "amount", "company"]} labels={{ save: "Enregistrer" }} />`,
    ),
    permissions: { ...read, write: ["deals"] },
    expect: "Enregistrer",
  },
  {
    block: "RecordDetail",
    source: page("RecordDetail", `<RecordDetail object="companies" recordId="${COMPANY_1}" />`),
    permissions: read,
    expect: "Lyon",
  },
  {
    block: "KpiCard",
    source: page("KpiCard", `<KpiCard object="deals" op="sum" field="amount" title="Pipeline" format="currency" />`),
    permissions: read,
    expect: "Pipeline",
  },
  {
    block: "ChartCard",
    source: page("ChartCard", `<ChartCard object="deals" groupBy="stage" title="Deals by stage" />`),
    permissions: read,
    expect: "Deals by stage",
  },
  {
    block: "FilterBar",
    source: page("FilterBar", `<FilterBar object="deals" onChange={() => {}} />`),
    permissions: read,
    expect: "Stage",
  },
  {
    block: "FileDrop",
    source: page("FileDrop", `<FileDrop onUploaded={() => {}} labels={{ drop: "Déposez vos fichiers" }} />`),
    permissions: { objects: [], files: true },
    expect: "Déposez vos fichiers",
  },
  {
    block: "CommandPalette",
    source: page(
      "CommandPalette",
      `<CommandPalette object="companies" commands={[{ id: "new", label: "New deal", run: () => {} }]} />`,
    ),
    permissions: read,
    expect: "New deal",
  },
];

// Dashboard = TSX page made of KpiCard and ChartCard (replaces the
// dedicated dashboards).
export const DASHBOARD_EXAMPLE: KitExample = {
  block: "dashboard",
  source: `import { ChartCard, KpiCard } from "@getrunbase/kit";

export default function Dashboard() {
  return (
    <div className="grid gap-4 p-4 md:grid-cols-3">
      <KpiCard object="deals" title="Deals" />
      <KpiCard object="deals" op="sum" field="amount" title="Pipeline" format="currency" />
      <KpiCard object="deals" op="avg" field="amount" title="Average deal" format="currency" />
      <div className="md:col-span-2">
        <ChartCard object="deals" groupBy="stage" op="sum" field="amount" title="Pipeline by stage" />
      </div>
      <ChartCard object="deals" groupBy="stage" kind="pie" title="Deals by stage" />
    </div>
  );
}
`,
  permissions: read,
  expect: "Pipeline by stage",
};
