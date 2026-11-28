"use client";
// `code` block: renders a code component in <iframe sandbox="allow-scripts">
// (without allow-same-origin: opaque origin, no access to the app DOM, cookies or
// storage; runtime CSP: no fetch and no external resource, but
// self-navigation is still possible, see code-runtime.ts). The bundle and props
// go through postMessage; the iframe SDK calls are relayed to the server
// (component permissions), with a timeout and a per-second call cap.
// The parent also relays: toasts, navigation (validated), persistent state in
// the URL (`c.<block>.<key>`) and live changes of readable objects.
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { errorText } from "@/lib/error-text";
import {
  acceptOrigin,
  limiter,
  runtimeSrc,
  sdkGuard,
} from "@/lib/runtime-bridge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  reportDeduper,
  stackSummary,
} from "@/components/code-runtime/describe-error";

export type CodeHost = {
  bundle: (
    blockId: string,
  ) => Promise<{ bundle: string; css?: string; objects?: string[] }>;
  call: (
    blockId: string,
    call: { method: unknown; args: unknown },
  ) => Promise<unknown>;
  // Component runtime error reported to the server (page.errors).
  report?: (
    blockId: string,
    error: { message: string; stack?: string },
  ) => Promise<unknown>;
  toast?: (level: "info" | "success" | "error", text: string) => void;
  navigate?: (to: { page: string; recordId?: string }) => void;
  // Subscription to changed objects ("*": reload everything).
  live?: (fn: (objects: string[] | "*") => void) => () => void;
  // Full page: fills the rest of the screen and keys relayed to the iframe.
  screen?: boolean;
};

const TIMEOUT_MS = 10_000;
const MAX_REPORTS_PER_SEC = 5;
const stackOf = (s: unknown) =>
  typeof s === "string" ? s.slice(0, 4_000) : undefined;
const MAX_HEIGHT = 20_000;
const MAX_PARAM = 2_000;
const SLUG = /^[A-Za-z0-9_-]{1,100}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Persistent block state read from the URL (`c.<block>.<key>` = JSON).
function readParams(blockId: string) {
  const out: Record<string, unknown> = {};
  const prefix = `c.${blockId}.`;
  for (const [k, v] of new URLSearchParams(location.search))
    if (k.startsWith(prefix))
      try {
        out[k.slice(prefix.length)] = JSON.parse(v);
      } catch {
        /* unreadable value ignored */
      }
  return out;
}
function writeParam(blockId: string, key: string, value: unknown) {
  const json = JSON.stringify(value ?? null);
  if (!/^[A-Za-z0-9_-]{1,50}$/.test(key) || json.length > MAX_PARAM) return;
  const url = new URL(location.href);
  if (value === undefined || value === null || value === "")
    url.searchParams.delete(`c.${blockId}.${key}`);
  else url.searchParams.set(`c.${blockId}.${key}`, json);
  history.replaceState(history.state, "", url);
}

function withTimeout<T>(p: Promise<T>, message: string) {
  return Promise.race([
    p,
    new Promise<never>((_, ko) =>
      setTimeout(() => ko(new Error(message)), TIMEOUT_MS),
    ),
  ]);
}

// Error banner: message, then the failing component and the first frames
// (collapsed) so the user can diagnose without devtools.
function ErrorBanner({ message, stack }: { message: string; stack?: string }) {
  const t = useTranslations("pages.code");
  const { frames, component } = stackSummary(stack);
  return (
    <Alert variant="destructive">
      <AlertDescription>
        <p>{message}</p>
        {(component || frames.length > 0) && (
          <details className="mt-1">
            <summary className="cursor-pointer text-xs">{t("details")}</summary>
            {component && (
              <p className="mt-1 text-xs">
                {t("component", { name: component })}
              </p>
            )}
            {frames.length > 0 && (
              <pre className="mt-1 overflow-x-auto font-mono text-xs whitespace-pre-wrap">
                {frames.join("\n")}
              </pre>
            )}
          </details>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function CodeFrame({
  id,
  props,
  height,
  host,
}: {
  id: string;
  props: Record<string, unknown>;
  height?: number | "auto" | "screen";
  host?: CodeHost;
}) {
  const t = useTranslations("pages.code");
  // Read via ref in the effect (like host): does not restart the iframe.
  const tRef = useRef(t);
  tRef.current = t;
  // Formatting locale (SDK `format`), set at iframe init.
  const locale = useLocale();
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const frame = useRef<HTMLIFrameElement>(null);
  const mode = height ?? (host?.screen ? "screen" : "auto");
  const screen = mode === "screen";
  const [h, setH] = useState(typeof mode === "number" ? mode : 120);
  const [error, setError] = useState<{
    message: string;
    stack?: string;
  } | null>(null);
  // Render finished (`idle` message or error): awaited by page.screenshot.
  const [done, setDone] = useState(false);
  const propsRef = useRef(props);
  propsRef.current = props;
  const send = useRef<(m: object) => void>(() => {});
  const started = useRef(false);
  // host changes on every refresh (params recreated): read via ref so the
  // effect is not restarted while the iframe itself does not reload.
  const hostRef = useRef(host);
  hostRef.current = host;
  const hasHost = !!host;
  const screenRef = useRef(screen);
  screenRef.current = screen;

  useEffect(() => {
    const el = frame.current;
    if (!el || !hasHost) return;
    let dead = false;
    let ready = false;
    let loads = 0;
    let bundle: string | null = null;
    let css = "";
    let objects: string[] = [];
    const fresh = reportDeduper();
    // Reported to the server once per message (richer stack kept), rate-capped (error
    // loop); a send failure is logged, never swallowed.
    const reports = limiter(MAX_REPORTS_PER_SEC);
    const report = (message: string, stack?: string) => {
      if (!fresh(message, stack) || !reports()) return false;
      hostRef.current
        ?.report?.(id, { message, stack })
        .catch((x: unknown) => console.warn("page error report failed", x));
      return true;
    };
    // Shown and reported.
    const fail = (message: string, stack?: string) => {
      setError({ message, stack });
      setDone(true);
      report(message, stack);
    };
    const guard = sdkGuard();
    started.current = false;
    // Opaque origin: only the "*" target is possible; we only write to our
    // iframe, stopped if it navigates elsewhere (second `load`).
    send.current = (m) => {
      if (!dead) el.contentWindow?.postMessage(m, "*");
    };
    const init = () => {
      if (!bundle || !ready || started.current) return;
      started.current = true;
      send.current({
        type: "init",
        bundle,
        props: propsRef.current,
        css,
        params: readParams(id),
        locale: localeRef.current,
      });
    };
    hostRef.current!.bundle(id).then(
      (r) => {
        bundle = r.bundle;
        css = r.css ?? "";
        objects = r.objects ?? [];
        init();
      },
      (e: Error) => fail(errorText(e, localeRef.current)),
    );
    const onLoad = () => {
      if (++loads > 1) {
        dead = true;
        fail(tRef.current("leftRuntime"));
      }
    };
    const onMessage = async (e: MessageEvent) => {
      if (dead || e.source !== el.contentWindow || !acceptOrigin(e.origin))
        return;
      const m = e.data as Record<string, unknown> | null;
      if (!m || typeof m !== "object") return;
      if (m.type === "ready") {
        ready = true;
        init();
      } else if (
        m.type === "resize" &&
        typeof m.height === "number" &&
        !screenRef.current
      )
        setH(Math.min(Math.max(Math.ceil(m.height), 24), MAX_HEIGHT));
      else if (m.type === "error")
        fail(String(m.message).slice(0, 500), stackOf(m.stack));
      else if (m.type === "report")
        report(String(m.message).slice(0, 1_000), stackOf(m.stack));
      else if (m.type === "idle") setDone(true);
      else if (m.type === "toast" && typeof m.text === "string")
        hostRef.current?.toast?.(
          m.level === "error" || m.level === "success" ? m.level : "info",
          m.text.slice(0, 200),
        );
      else if (
        m.type === "navigate" &&
        typeof m.page === "string" &&
        SLUG.test(m.page) &&
        (m.recordId === undefined ||
          (typeof m.recordId === "string" && UUID.test(m.recordId)))
      )
        hostRef.current?.navigate?.({
          page: m.page,
          recordId: m.recordId as string | undefined,
        });
      else if (m.type === "chunk" && (m.id === "tiptap" || m.id === "maplibre"))
        fetch(`/c/runtime/chunk/${m.id}`)
          .then((r) => {
            if (!r.ok) throw new Error(`chunk ${m.id}: ${r.status}`);
            return r.text();
          })
          .then(
            (js) => send.current({ type: "chunk", id: m.id, js }),
            (x: Error) => fail(x.message),
          );
      else if (m.type === "param" && typeof m.key === "string")
        writeParam(id, m.key, m.value);
      else if (m.type === "call" && Number.isSafeInteger(m.id)) {
        const limited = guard(m.method);
        if (limited)
          return send.current({
            type: "result",
            id: m.id,
            error: errorText(limited, localeRef.current),
          });
        try {
          const result = await withTimeout(
            hostRef.current!.call(id, { method: m.method, args: m.args }),
            tRef.current("timeout", { ms: TIMEOUT_MS }),
          );
          send.current({ type: "result", id: m.id, result });
        } catch (x) {
          send.current({
            type: "result",
            id: m.id,
            error: errorText(x, localeRef.current),
          });
        }
      }
    };
    // Live: only objects readable by the component are relayed.
    const unlive = hostRef.current!.live?.((changed) => {
      const mine =
        changed === "*" ? objects : changed.filter((o) => objects.includes(o));
      if (started.current && mine.length)
        send.current({ type: "changed", objects: mine });
    });
    // Full page: keyboard shortcuts relayed only when nothing has the
    // focus outside the iframe (body).
    const onKey = (e: KeyboardEvent) => {
      if (!screenRef.current || !started.current) return;
      if (e.isComposing) return;
      const a = document.activeElement;
      if (a && a !== document.body) return;
      send.current({
        type: "key",
        key: e.key,
        code: e.code,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
      });
    };
    window.addEventListener("keydown", onKey);
    el.addEventListener("load", onLoad);
    window.addEventListener("message", onMessage);
    return () => {
      dead = true;
      window.removeEventListener("keydown", onKey);
      unlive?.();
      el.removeEventListener("load", onLoad);
      window.removeEventListener("message", onMessage);
    };
  }, [id, hasHost]);

  const key = JSON.stringify(props);
  useEffect(() => {
    if (started.current)
      send.current({ type: "props", props: propsRef.current });
  }, [key]);

  if (!host)
    return (
      <p className="text-sm text-muted-foreground">{t("previewUnavailable")}</p>
    );
  return (
    <div
      className={
        screen ? "flex min-h-0 flex-1 flex-col gap-2" : "flex flex-col gap-2"
      }
      data-code-block={id}
      data-code-state={error ? "error" : done ? "ready" : "loading"}
      data-code-error={error?.message}
    >
      {error && <ErrorBanner {...error} />}
      <iframe
        ref={frame}
        src={runtimeSrc()}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        title={id}
        // Full page: fills the space left by its container (flex-1)
        // instead of a fixed screen height that the bar would overflow.
        className={
          screen ? "min-h-0 w-full flex-1 border-0" : "w-full border-0"
        }
        // color-scheme aligned with the iframe document (never declared):
        // otherwise, with a dark page, the browser paints an opaque white background.
        style={{
          colorScheme: "normal",
          height: screen ? undefined : h,
        }}
      />
    </div>
  );
}
