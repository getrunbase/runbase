# @runbase/sdk

Hooks for Runbase code components (React, rendered in a sandboxed iframe).
Every call goes through the host and is checked against the permissions the
component declares.

```tsx
import { useQuery, useMutation } from "@runbase/sdk";

export default function Deals() {
  const { data } = useQuery({ object: "deals", sort: [{ field: "amount", dir: "desc" }] });
  const { update } = useMutation("deals");
  return data.map((d) => (
    <button key={d.id} onClick={() => update(d.id, { stage: "won" })}>{String(d.data.name)}</button>
  ));
}
```

| Hook | Permission |
| --- | --- |
| `useQuery`: live (SSE, Redis fan-out), reloaded when the object changes | `objects` |
| `useInfiniteQuery`: keyset pages (`after = next`) | `objects` |
| `useAggregate`: server-side `groupBy` + `count/sum/avg/min/max` | `objects` |
| `useRecord`, `useTimeline`, `useObject` | `objects` |
| `useMutation`: optimistic `create/update/remove`, rolled back on error | `write` |
| `useUpload`: uploads a file, returns a `file` field value | `files: true` |
| `useRun`: `startWorkflow` + run status polling | `workflows` |
| `useUser`, `useParam`, `useNow`, `toast`, `navigate` | none |

An undeclared call is refused.

## Build

```sh
pnpm --filter @runbase/sdk build   # dist/*.js + dist/*.d.ts
```

## License

MIT
