// SDK live (real-time useQuery): SSE stream of a workspace's record
// changes, filtered by the readable objects (page permissions).
// Fan-out through Redis pub/sub (bus): a change made on another web node
// arrives as well.
import { subscribeRecords, type RecordChange } from "../bus";
import { pagesService } from "../pages";
import type { TenantContext } from "../tenant";
import { permissionsSchema } from "./sdk";

const PING_MS = 25_000;

// Readable objects declared by the page (invalid permissions: none).
// `draft`: draft permissions (write scope required by pagesService.get).
export async function pageReadable(
  ctx: TenantContext,
  pageId: string,
  opts: { draft?: boolean } = {},
) {
  const page = await pagesService.get(ctx, pageId, { draft: opts.draft });
  if (!page) return null;
  const p = permissionsSchema.safeParse(page.permissions ?? {});
  return p.success ? p.data.objects : [];
}

// `text/event-stream` stream: one `{objects: [id]}` message per change of an
// object in `objects`, periodic ping, closed with `signal`.
export function liveStream(
  workspaceId: string,
  objects: string[],
  signal?: AbortSignal,
) {
  const enc = new TextEncoder();
  let close = () => {};
  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      const send = (s: string) => {
        try {
          ctrl.enqueue(enc.encode(s));
        } catch {
          close(); // stream already closed
        }
      };
      const sub = subscribeRecords(workspaceId, (c: RecordChange) => {
        if (objects.includes(c.objectId))
          send(`data: ${JSON.stringify({ objects: [c.objectId] })}\n\n`);
      });
      const ping = setInterval(() => send(": ping\n\n"), PING_MS);
      close = () => {
        clearInterval(ping);
        sub.close();
        try {
          ctrl.close();
        } catch {
          // already closed
        }
      };
      signal?.addEventListener("abort", close);
      // Redis subscription active: the client can rely on live.
      return sub.ready.then(() => send(": ready\n\n"));
    },
    cancel: () => close(),
  });
}
