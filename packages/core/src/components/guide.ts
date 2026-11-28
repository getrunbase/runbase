// Design guide served by page.guide: structure of a TSX page package,
// @getrunbase/sdk hooks, @getrunbase/kit blocks, permissions and strict rules.
export function componentsGuide(ui: string[]) {
  return `# Pages: package and design guide

Goal: an interface a product designer would sign off on. Dense, readable, live data, every state handled. The rules below are strict: follow them, do not invent a visual language.

## Method (required)
1. Read the real data: objects.get (field keys, select options, uuids), records.search (a few rows).
2. Start from an example: page.examples (crm, kanban, dashboard). Each one is a full package with mock \`data\`.
   Slugs (\`deals\`), ids and values only apply to the mock. Live, objects and records are referenced by **uuid** (objects.get, records.search); field keys and option values come from objects.get.
3. Prefer a @getrunbase/kit block over custom code. Write custom components only for what no block covers.
4. page.create with the package, then page.screenshot (desktop and mobile) and page.errors. Fix and repeat until the render is clean and the console is empty.
5. page.update writes a draft: check it with page.screenshot \`{draft: true}\`, then page.publish.

## Package structure
- A page is a package of TSX files: \`{"<relative path>": "<source>"}\`, entry \`index.tsx\` by default. The entry default-exports the page component.
- Split by responsibility: \`index.tsx\` (layout and page state), \`components/<name>.tsx\` (one component per file, named export).
- Import package files with relative paths (\`./components/deal-panel\`), never \`..\` outside the package and never a URL.
- Allowed modules: \`react\`, \`@getrunbase/sdk\`, \`@getrunbase/kit\`, \`lucide-react\`, \`recharts\`, \`date-fns\`, \`@ui/<name>\`.
- \`@ui/<name>\` (shadcn): ${ui.join(", ")}.
- No hard-coded schema: object ids and field keys live in constants at the top of the entry, or come from \`useObject\`.

## Permissions
The page declares \`permissions\`; every SDK call is checked server-side against them.
- \`objects\`: readable objects (uuids). \`write\`: objects the page may create, update or delete in. \`workflows\`: workflows it may start. \`files\`: upload allowed.
- \`ai\`: AI configs the page may call with useAI, \`{ "default": { "provider", "model", "secret" }, "<name>": {...} }\`. \`useAI()\` uses \`default\`, \`useAI("<name>")\` a named one. There is no workspace default: without a matching config, the call fails. \`secret\` names a workspace secret (secrets.list), read server-side and never sent to the page.
- Grant the minimum: a dashboard only reads. A call outside the permissions fails and is reported by page.errors.

## Blocks (@getrunbase/kit)
Data-bound blocks, built on the SDK and @ui. Each one handles its own loading, empty and error states. Texts default to English; pass \`labels\` to translate.
- \`DataTable {object, fields?, filter?, searchable?, onRowClick?}\`: server-side sort and search, virtualized rows.
- \`Kanban {object, groupBy, titleField?, subtitleField?, filter?, onCardClick?}\`: columns = select options; drag and drop writes \`groupBy\` (needs \`write\`).
- \`Calendar {object, dateField, titleField?, filter?, onSelect?}\`, \`Gallery {object, fields?, filter?}\`, \`Timeline {recordId}\`.
- \`RecordForm {object, recordId?, fields?, exclude?, onSaved?}\`: create without \`recordId\`, edit with it; typed inputs and validation from the schema.
- \`RecordDetail {object, recordId, fields?}\`: read-only field list.
- \`KpiCard {object, op?, field?, filter?, title, format?}\` and \`ChartCard {…KpiCard, groupBy, kind?: "bar"|"line"|"pie"}\`: aggregated server-side.
- \`FilterBar {object, fields?, onChange}\`: emits \`{q?, filter?}\` to pass to DataTable, Kanban or Gallery.
- \`FileDrop {onUploaded}\` (needs \`files\`), \`CommandPalette {object?, commands?}\`.
- A dashboard is a page made of KpiCard and ChartCard in a grid.

## SDK (@getrunbase/sdk)
- \`useQuery({object, filter?, sort?, q?, limit?, after?, groupBy?, aggregate?, enabled?})\` returns \`{data, total, loading, error, reload, hasMore, fetchMore}\`.
  - \`limit\`: 50 by default, 1000 max. \`after\`: keyset pagination. \`enabled: false\`: no request.
  - KPIs and charts: \`groupBy\` and \`aggregate: [{op: "count"|"sum"|"avg"|"min"|"max", field?, as}]\`, never by loading every row.
  - Filter: \`{field, op, value}\`, \`{all: [...]}\` or \`{any: [...]}\`. Operators: eq, neq, in, contains, starts_with, gt, gte, lt, lte, between, before, after, within, older_than, is_empty, is_not_empty.
- Every record (useQuery, useInfiniteQuery, useRecord, mutation results) has one shape: \`{id, objectId, data}\`, fields under \`data\`. Type it: \`useQuery<Deal>(...)\` returns \`Row<Deal>[]\`, \`useRecord<Deal>(id)\` a \`Row<Deal>\`. Never \`any\` around SDK results, never \`r.data ?? r\`.
- \`useRecord(id, {include?})\`, \`useTimeline(recordId)\`, \`useObject(id)\` (fields, labels, options), \`useUser()\`.
- \`useMutation(object)\` returns \`{create, update, remove, pending}\`; optimistic by default, rolled back with an error toast if the server refuses.
- Reads reload on their own when data changes (other users, workflows, mutations).
- \`toast(text, kind)\`, \`navigate({page, recordId?})\`, \`useParam(key, fallback)\` (state in the URL), \`startWorkflow(id, {recordId?})\`, \`format.date/currency/number/percent/relative\`.

## Design rules (strict)
- **Spacing**: 4/8 px grid only. Page \`p-4 md:p-6\`, sections \`gap-6\`, inside a card \`gap-4\`, inline \`gap-2\`. No arbitrary values (\`p-[13px]\`).
- **Width**: page content in \`mx-auto max-w-7xl\`. Grids: \`grid gap-4 sm:grid-cols-2 lg:grid-cols-4\` for KPIs, \`lg:grid-cols-3\` for charts.
- **Hierarchy**: exactly one \`h1\` per page (\`text-xl font-semibold tracking-tight\`) with a one-line \`text-sm text-muted-foreground\` subtitle. Card titles \`text-base\`. Labels \`text-xs font-medium text-muted-foreground\`. Three text levels at most.
- **Colors**: semantic tokens only (bg-background, bg-card, bg-muted, text-foreground, text-muted-foreground, border, primary, destructive, chart-1 to chart-5). Never \`#hex\`, \`rgb()\` or palette classes (\`bg-blue-500\`). No custom colors, fonts, radii or shadows: the look is fixed by the platform.
- **Typography**: \`text-sm\` by default, \`tabular-nums\` for numbers, \`truncate\` + \`min-w-0\` for long text.
- **Surfaces**: \`Card\` from @ui/card for grouped content, no nested cards, no decorative gradients or images.
- **Icons**: lucide-react \`size-4\`, always with text or an \`aria-label\`.

## States (all required)
- **Loading**: kit blocks show skeletons; custom components use \`Skeleton\` (@ui/skeleton) in the final shape, never a lone "Loading…".
- **Empty**: an icon, a useful sentence and an action when possible ("No deals in this stage").
- **Error**: a destructive \`Alert\` with the message and a Retry button (\`reload\`).
- **Pending**: \`disabled\` on the button while a mutation runs; short success toast.

## Responsive
- Mobile first: one column, then \`sm:\`, \`md:\`, \`lg:\`. Check the mobile screenshot.
- No fixed width above 360 px without \`max-w\`. Wide tables and kanbans: \`overflow-x-auto\` on a \`min-w-0\` parent.

## Accessibility
- Semantic landmarks: \`main\`, \`header\`, \`section aria-label\`, \`aside aria-label\`.
- Real \`button\` and \`a\` elements; icon-only buttons have an \`aria-label\`. Everything works from the keyboard; focus stays visible.
- Form fields have a \`Label\`. AA contrast (tokens guarantee it). Never convey information by color alone.
`;
}
