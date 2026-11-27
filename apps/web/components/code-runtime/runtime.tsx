// Sandbox iframe runtime (opaque origin, CSP connect-src 'none'): receives
// the component bundle through postMessage from the parent, renders it, and exposes the SDK
// whose every call is relayed to the parent (which passes it to the server services).
import {
  createElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { Boundary } from "./boundary";
import { describeConsoleArgs, describeError } from "./describe-error";
import { format, setFormatLocale } from "./format";
import { lazyChunks, modules } from "./modules";
import {
  createStore,
  keyOf,
  type RunbaseSdk,
  type Snap,
} from "@getrunbase/sdk";

// WebRTC removed before any bundle: the connect-src CSP does not cover
// RTCPeerConnection (UDP/STUN to the network, exfiltration).
for (const k of [
  "RTCPeerConnection",
  "webkitRTCPeerConnection",
  "RTCDataChannel",
] as const)
  delete (window as unknown as Record<string, unknown>)[k];

type Msg = Record<string, unknown>;
const post = (m: Msg) => parent.postMessage(m, "*");
const pending = new Map<
  number,
  { ok: (v: unknown) => void; ko: (e: Error) => void }
>();
let seq = 0;
// Stability (captures): `idle` emitted when no SDK call has been pending
// for 300 ms and the fonts are ready.
let lastActive = Date.now();
let idleSent = false;

function call(method: string, args: unknown) {
  return new Promise<unknown>((ok, ko) => {
    const id = ++seq;
    lastActive = Date.now();
    idleSent = false;
    pending.set(id, { ok, ko });
    post({ type: "call", id, method, args });
  });
}

const store = createStore(call);
const LOADING: Snap = { loading: true };
const NONE: Snap = { loading: false };
type Args = Record<string, unknown>;

// Cached read, shared and reloaded by live updates and mutations.
function useEntry(method: string, args: Args | null) {
  const key = args ? keyOf(method, args) : "";
  const argsRef = useRef(args);
  argsRef.current = args;
  const sub = useCallback(
    (fn: () => void) =>
      argsRef.current ? store.subscribe(method, argsRef.current, fn) : () => {},
    [key],
  );
  const snap = useSyncExternalStore(sub, () =>
    key ? (store.get(key) ?? LOADING) : NONE,
  );
  return { ...snap, reload: () => store.reload(key) };
}

type Page = { rows: unknown[]; total: number; next?: string | null };
function useQuery({ enabled, ...args }: Args) {
  const key = JSON.stringify(args);
  const [more, setMore] = useState({ key, n: 0 });
  const n = more.key === key ? more.n : 0;
  const base = Number(args.limit ?? 50);
  // `enabled: false`: no request (e.g. waiting for a selection).
  const s = useEntry(
    "query",
    enabled === false
      ? null
      : n
        ? { ...args, limit: Math.min(1000, base * (n + 1)) }
        : args,
  );
  // Previous data kept during a reload (no flicker).
  const last = useRef<Page | undefined>(undefined);
  if (s.data) last.current = s.data as Page;
  const d = (s.data as Page | undefined) ?? last.current;
  return {
    data: d?.rows ?? [],
    total: d?.total ?? 0,
    loading: s.loading,
    error: s.error,
    reload: s.reload,
    hasMore: (d?.rows.length ?? 0) < (d?.total ?? 0),
    fetchMore: () => setMore({ key, n: n + 1 }),
  };
}

// Accumulated keyset pages (`after = next`), reloaded live (page 1).
function useInfiniteQuery({ enabled, ...args }: Args) {
  const s = useEntry("infinite", enabled === false ? null : args);
  const key = enabled === false ? "" : keyOf("infinite", args);
  const d = s.data as Page | undefined;
  return {
    data: d?.rows ?? [],
    total: d?.total ?? 0,
    loading: s.loading,
    error: s.error,
    reload: s.reload,
    hasNextPage: !!d?.next,
    fetchNextPage: () => store.more(key),
  };
}

function useAggregate({ enabled, ...args }: Args) {
  const s = useEntry("aggregate", enabled === false ? null : args);
  return { ...s, data: (s.data as Page | undefined)?.rows ?? [] };
}

const toBase64 = async (f: Blob) => {
  const b = new Uint8Array(await f.arrayBuffer());
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000)
    s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

function useUpload() {
  const [state, setState] = useState<{ pending: number; error?: string }>({
    pending: 0,
  });
  const upload = async (file: File): Promise<Result> => {
    setState((x) => ({ pending: x.pending + 1 }));
    try {
      const data = await call("upload", {
        name: file.name,
        ...(file.type && { type: file.type }),
        base64: await toBase64(file),
      });
      setState((x) => ({ pending: x.pending - 1 }));
      return { ok: true, data };
    } catch (e) {
      const error = (e as Error).message;
      setState((x) => ({ pending: x.pending - 1, error }));
      return { ok: false, error };
    }
  };
  return { upload, pending: state.pending > 0, error: state.error };
}

// useAI: server-side completion with the page's AI config `name` (default:
// `default`); permission, budget and rate checked server-side.
function useAI(name?: string) {
  const [state, setState] = useState<{
    pending: number;
    text?: string;
    error?: string;
  }>({ pending: 0 });
  const ask = async (prompt: string, opts?: { system?: string }) => {
    setState((x) => ({ ...x, pending: x.pending + 1 }));
    try {
      const data = (await call("ai", {
        prompt,
        ...(opts?.system && { system: opts.system }),
        ...(name && { name }),
      })) as { text: string };
      setState((x) => ({ pending: x.pending - 1, text: data.text }));
      return { ok: true, data } as Result;
    } catch (e) {
      const error = (e as Error).message;
      setState((x) => ({ ...x, pending: x.pending - 1, error }));
      return { ok: false, error } as Result;
    }
  };
  return {
    ask,
    text: state.text,
    pending: state.pending > 0,
    error: state.error,
  };
}

type RunState = { runId: string; status: string; error?: string | null };
const RUN_DONE = ["succeeded", "failed", "canceled"];
// startWorkflow + status tracking (re-read every 1.5 s until the end).
function useRun(workflowId: string) {
  const [run, setRun] = useState<RunState | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const start = async (opts?: { recordId?: string }) => {
    let r = (await call("workflow", { id: workflowId, ...opts })) as RunState;
    setRun(r);
    while (alive.current && !RUN_DONE.includes(r.status)) {
      await new Promise((ok) => setTimeout(ok, 1500));
      r = (await call("run", { id: r.runId })) as RunState;
      if (alive.current) setRun(r);
    }
    return r;
  };
  return {
    start,
    run,
    running: !!run && !RUN_DONE.includes(run.status),
  };
}

const toast = (text: string, level: "info" | "success" | "error" = "info") =>
  post({ type: "toast", level, text: String(text).slice(0, 200) });

type Result = { ok: boolean; data?: unknown; error?: string };
type MutOpts = { optimistic?: boolean; success?: string };
function useMutation(object?: string) {
  const [pendingN, setPending] = useState(0);
  const run = async (
    kind: "create" | "update" | "delete",
    args: Args,
    opts: MutOpts = {},
  ): Promise<Result> => {
    setPending((x) => x + 1);
    try {
      const data = await store.mutate(kind, args, opts);
      if (opts.success) toast(opts.success, "success");
      return { ok: true, data };
    } catch (e) {
      toast((e as Error).message, "error");
      return { ok: false, error: (e as Error).message };
    } finally {
      setPending((x) => x - 1);
    }
  };
  return {
    pending: pendingN > 0,
    create: (data: Args, opts?: MutOpts & { object?: string }) =>
      run("create", { object: opts?.object ?? object, data }, opts),
    update: (id: string, patch: Args, opts?: MutOpts) =>
      run("update", { id, patch }, opts),
    remove: (id: string, opts?: MutOpts) => run("delete", { id }, opts),
  };
}

// Per-component state persisted in the parent URL (c.<block>.<key>).
let params: Record<string, unknown> = {};
const paramSubs = new Set<() => void>();
function useParam<T>(key: string, initial: T) {
  const v = useSyncExternalStore(
    (fn) => (paramSubs.add(fn), () => paramSubs.delete(fn)),
    () => params[key],
  );
  const set = (next: T) => {
    params = { ...params, [key]: next };
    paramSubs.forEach((f) => f());
    post({ type: "param", key, value: next });
  };
  return [(v === undefined ? initial : v) as T, set] as const;
}

function useNow(ms = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), Math.max(ms, 1000));
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const sdk = {
  useQuery,
  useInfiniteQuery,
  useAggregate,
  useUpload,
  useRun,
  useAI,
  useRecord: (id: string | null | undefined, opts?: { include?: string[] }) =>
    useEntry(
      "record",
      id ? { id, ...(opts?.include && { include: opts.include }) } : null,
    ),
  useTimeline: (recordId: string | null | undefined) => {
    const s = useEntry("timeline", recordId ? { recordId } : null);
    return { ...s, data: (s.data as unknown[] | undefined) ?? [] };
  },
  useObject: (id: string | null | undefined) =>
    useEntry("object", id ? { id } : null),
  useUser: () => useEntry("user", {}).data ?? null,
  useMutation,
  useParam,
  useNow,
  now: () => new Date(),
  format,
  toast,
  navigate: (to: { page: string; recordId?: string }) =>
    post({ type: "navigate", page: to.page, recordId: to.recordId }),
  startWorkflow: (id: string, opts?: { recordId?: string }) =>
    call("workflow", { id, ...opts }),
} as unknown as RunbaseSdk;
(globalThis as Msg).__vendor = { ...modules, "@getrunbase/sdk": sdk };

let root: Root | undefined;
let C: unknown;
let latestProps: unknown;
// Lazy chunks: requested from the parent (CSP: inline scripts only), injected
// as <script> on receipt.
const chunkWaits = new Map<string, () => void>();
const loadChunk = (id: string) =>
  new Promise<void>((resolve) => {
    chunkWaits.set(id, resolve);
    post({ type: "chunk", id });
  });
const draw = (props: unknown) =>
  root!.render(
    createElement(
      Boundary,
      { onError: (e) => post({ type: "error", ...e }) },
      createElement(C as never, (props ?? {}) as never),
    ),
  );

addEventListener("message", (e) => {
  if (e.source !== parent) return;
  const m = e.data as Msg | null;
  if (!m || typeof m !== "object") return;
  if (m.type === "init" && !root) {
    const style = document.createElement("style");
    style.textContent = String(m.css ?? "");
    document.head.append(style);
    if (m.params && typeof m.params === "object") params = m.params as Msg;
    setFormatLocale(m.locale);
    setInterval(() => {
      if (idleSent || pending.size || Date.now() - lastActive < 300) return;
      idleSent = true;
      void document.fonts.ready.then(() => post({ type: "idle" }));
    }, 100);
    root = createRoot(document.getElementById("root")!);
    const bundle = String(m.bundle);
    latestProps = m.props;
    void Promise.all(lazyChunks(bundle).map(loadChunk)).then(
      () => {
        const s = document.createElement("script");
        // Stable name in stacks: remapped via sourcemap on the server.
        s.textContent = `${bundle}\n//# sourceURL=runbase-page.js`;
        document.head.append(s);
        C = ((globalThis as Msg).__C as Msg | undefined)?.default;
        if (typeof C !== "function")
          return post({
            type: "error",
            message: "component default export is missing",
          });
        draw(latestProps);
      },
      (e: unknown) =>
        post({ type: "error", message: `module load failed: ${String(e)}` }),
    );
  } else if (m.type === "chunk" && typeof m.id === "string") {
    const done = chunkWaits.get(m.id);
    if (!done) return;
    chunkWaits.delete(m.id);
    const s = document.createElement("script");
    s.textContent = String(m.js);
    document.head.append(s);
    done();
  } else if (m.type === "props" && root) {
    latestProps = m.props;
    if (typeof C === "function") draw(m.props);
  } else if (m.type === "changed")
    store.invalidate(Array.isArray(m.objects) ? m.objects.map(String) : "*");
  else if (m.type === "key" && typeof m.key === "string")
    // Key relayed by the parent (full page, focus outside a field).
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: m.key,
        code: String(m.code ?? ""),
        ctrlKey: m.ctrlKey === true,
        metaKey: m.metaKey === true,
        shiftKey: m.shiftKey === true,
        altKey: m.altKey === true,
        bubbles: true,
        cancelable: true,
      }),
    );
  else if (m.type === "result" && typeof m.id === "number") {
    const p = pending.get(m.id);
    pending.delete(m.id);
    lastActive = Date.now();
    if (typeof m.error === "string") p?.ko(new Error(m.error));
    else p?.ok(m.result);
  }
});
addEventListener("error", (e) => {
  const d = describeError(e.error ?? e.message);
  post({ type: "error", message: d.message, stack: d.stack });
});
// Non-blocking errors: reported to the server without hiding the page.
addEventListener("unhandledrejection", (e) => {
  const d = describeError(e.reason);
  post({ type: "report", message: d.message, stack: d.stack });
});
const consoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  consoleError(...args);
  post({ type: "report", ...describeConsoleArgs(args) });
};
new ResizeObserver(() =>
  post({ type: "resize", height: document.documentElement.scrollHeight }),
).observe(document.body);
post({ type: "ready" });
