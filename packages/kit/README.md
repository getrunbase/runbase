# @runbase/kit

Ready-made, data-bound blocks for Runbase TSX pages, built on the
`@runbase/sdk` hooks and the host's shadcn/ui components (`@ui/<name>`).

```tsx
import { DataTable, KpiCard } from "@runbase/kit";

export default function Deals() {
  return (
    <>
      <KpiCard object="deals" op="sum" field="amount" title="Pipeline" />
      <DataTable object="deals" />
    </>
  );
}
```

Blocks: `DataTable`, `Kanban`, `Calendar`, `Timeline`, `Gallery`,
`RecordForm`, `RecordDetail`, `KpiCard`, `ChartCard`, `FilterBar`, `FileDrop`,
`CommandPalette`. Each one handles its loading, empty and error states.
Visible texts come from props (`labels`, `title`…): English defaults, the page
passes its own translations. No custom theme: shadcn tokens only.

Examples: `src/examples.ts` (one page per block).

## License

MIT
