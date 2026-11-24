// page.test harness: runs in the Deno sandbox without permissions.
// Renders the bundle with renderToString and a simulated SDK serving `data`
// ({<object id>: rows[], records: {<id>: record}}); returns the SDK calls.
import "./harness-env";
import { createElement } from "react";
import { renderToString } from "react-dom/server.browser";
import { mockCall } from "@runbase/core/components/mock";
import { format } from "./format";
import { modules } from "./modules";

type Input = {
  bundle: string;
  props: Record<string, unknown>;
  data: Record<string, unknown>;
};

export default function render({ bundle, props, data }: Input) {
  const sdkCalls: { method: string; args: unknown }[] = [];
  const mock = (method: string, args: unknown) => {
    sdkCalls.push({ method, args });
    return mockCall(data, method, args);
  };
  const done = (v: unknown) => ({ data: v, loading: false, reload() {} });
  const later = (method: string, args: unknown) =>
    Promise.resolve(mock(method, args));
  const mut = (kind: string, args: object) =>
    later(kind, args).then((d) => ({ ok: true, data: d }));
  // Same surface as the runtime SDK (synchronous render, simulated data).
  const sdk = {
    useQuery: ({ enabled, ...args }: Record<string, unknown>) => {
      const r = (
        enabled === false ? { rows: [], total: 0 } : mock("query", args)
      ) as { rows: unknown[]; total: number };
      return {
        ...done(r.rows),
        total: r.total,
        hasMore: r.rows.length < r.total,
        fetchMore() {},
      };
    },
    useInfiniteQuery: ({ enabled, ...args }: Record<string, unknown>) => {
      const r = (
        enabled === false ? { rows: [], total: 0 } : mock("query", args)
      ) as { rows: unknown[]; total: number };
      return {
        ...done(r.rows),
        total: r.total,
        hasNextPage: r.rows.length < r.total,
        fetchNextPage() {},
      };
    },
    useAggregate: ({ enabled, ...args }: Record<string, unknown>) =>
      done(
        enabled === false
          ? []
          : (mock("aggregate", args) as { rows: unknown[] }).rows,
      ),
    useUpload: () => ({
      pending: false,
      upload: (f: File) =>
        mut("upload", { name: f.name, type: f.type, base64: "" }),
    }),
    useRecord: (id: string, opts?: { include?: string[] }) =>
      done(id ? mock("record", { id, ...opts }) : null),
    useTimeline: (recordId: string) =>
      done(recordId ? mock("timeline", { recordId }) : []),
    useObject: (id: string) => done(id ? mock("object", { id }) : null),
    useUser: () => mock("user", {}),
    useMutation: (object?: string) => ({
      pending: false,
      create: (d: object, o?: { object?: string }) =>
        mut("create", { object: o?.object ?? object, data: d }),
      update: (id: string, patch: object) => mut("update", { id, patch }),
      remove: (id: string) => mut("delete", { id }),
    }),
    useParam: <T,>(_k: string, initial: T) => [initial, () => {}] as const,
    useNow: () => Date.now(),
    now: () => new Date(),
    format,
    toast() {},
    navigate() {},
    startWorkflow: (id: string, opts?: object) =>
      later("workflow", { id, ...opts }),
  };
  (globalThis as Record<string, unknown>).__vendor = {
    ...modules,
    "@runbase/sdk": sdk,
  };
  try {
    const C = (new Function(`${bundle};return __C`)() as { default?: unknown })
      .default;
    if (typeof C !== "function")
      throw new Error("export default du composant manquant");
    const html = renderToString(createElement(C as never, props as never));
    return { errors: [], html: html.slice(0, 20_000), sdkCalls };
  } catch (e) {
    return {
      errors: [{ text: String((e as Error)?.stack ?? e).slice(0, 2_000) }],
      html: "",
      sdkCalls,
    };
  }
}
