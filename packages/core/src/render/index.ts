// Captures and accessibility audits delegated to the renderer service:
// Chromium no longer lives in the web app. The web pushes a BullMQ job (queue
// `render`) and waits for the result; the renderer stores PNGs through the file
// driver (keys `<workspace>/renders/<job>/…`), the web reads them back then
// deletes them. Only serializable types go through Redis.
import { Queue, QueueEvents } from "bullmq";
import { queueOptions } from "../bus";
import type { ComponentPermissions } from "../components/sdk";
import type { MockData } from "../components/mock";
import { appError } from "../errors/app-error";
import { fileStorage } from "../files";
import type { TenantContext } from "../tenant";

export { renderSweeper, RENDER_KEY_TTL_MS } from "./sweeper";

export const RENDER_QUEUE = "render";

export type Viewport = "desktop" | "mobile";
export type Theme = "light";

// Simple interactions played before the capture.
export type Interaction =
  | { click: string }
  | { type: string; text: string }
  | { wait: number | string };

// App page loaded by its URL (reachable from the renderer),
// authenticated by a short read-only capture token.
export type PageRenderJob = {
  kind: "page";
  workspaceId: string;
  url: string;
  token: string;
  viewport: Viewport;
  theme: Theme;
  // axe-core audit of the rendered page (WCAG violations).
  audit?: boolean;
};

// Code component rendered by the iframe runtime; SDK calls are
// served by the renderer: provided data (mock) or real reads of the
// workspace with the component permissions (live).
export type ComponentRenderJob = {
  kind: "component";
  ctx: TenantContext;
  html: string;
  csp: string;
  bundle: string;
  css: string;
  props: Record<string, unknown>;
  viewports: Viewport[];
  themes: Theme[];
  interactions?: Interaction[];
  data:
    | { mode: "mock"; data: MockData }
    | { mode: "live"; perms: ComponentPermissions };
};

export type RenderJob = PageRenderJob | ComponentRenderJob;

export type A11yViolation = {
  id: string;
  impact: string | null;
  help: string;
  nodes: number;
  targets: string[];
};

type Report<S> = {
  shots: S[];
  errors: string[];
  console: string[];
  sdkCalls?: unknown[];
  a11y?: A11yViolation[];
};
// Job result (Redis): PNGs referenced by their storage key.
export type RenderResult = Report<{
  viewport: Viewport;
  theme: Theme;
  key: string;
}>;
export type Shot = { viewport: Viewport; theme: Theme; png: Buffer };
export type ShotReport = Report<Shot>;

export const jobWorkspace = (j: RenderJob) =>
  j.kind === "page" ? j.workspaceId : j.ctx.workspaceId;
export const shotKey = (
  workspaceId: string,
  jobId: string,
  s: { viewport: Viewport; theme: Theme },
) => `${workspaceId}/renders/${jobId}/${s.viewport}-${s.theme}.png`;

// Below typical MCP client request timeouts (~30 s), so the caller gets
// platform.renderTimeout instead of a generic client-side timeout.
const WAIT_MS = 25_000;
// Bounded queue: beyond that, immediate refusal rather than an endless wait.
const MAX_WAITING = 16;

let queue: Queue<RenderJob, RenderResult> | undefined;
export const renderQueue = () =>
  (queue ??= new Queue(RENDER_QUEUE, queueOptions()));
let events: QueueEvents | undefined;
const renderEvents = () =>
  (events ??= new QueueEvents(RENDER_QUEUE, queueOptions()));

export async function render(job: RenderJob): Promise<ShotReport> {
  const q = renderQueue();
  const ev = renderEvents();
  if ((await q.getWaitingCount()) >= MAX_WAITING)
    throw appError(
      "platform.renderBusy",
      "Too many captures in progress, try again in a moment",
    );
  await ev.waitUntilReady();
  const j = await q.add(job.kind, job, {
    removeOnComplete: 100,
    removeOnFail: 100,
  });
  let out: RenderResult;
  try {
    out = await j.waitUntilFinished(ev, WAIT_MS);
  } catch (e) {
    const msg = (e as Error).message;
    if (/timed out/i.test(msg)) {
      // Renderer missing or saturated: the job is not left pending.
      await j.remove().catch(() => {});
      throw appError(
        "platform.renderTimeout",
        "The rendering service did not answer within {seconds} s",
        { seconds: WAIT_MS / 1000 },
      );
    }
    throw appError("platform.renderFailed", "Rendering failed: {reason}", {
      reason: msg.slice(0, 300),
    });
  }
  const storage = fileStorage();
  const ws = jobWorkspace(job);
  const shots: Shot[] = [];
  for (const s of out.shots) {
    // A key outside the job's workspace is never read back.
    if (!s.key.startsWith(`${ws}/renders/`)) continue;
    const f = await storage.get(s.key);
    await storage.remove(s.key);
    if (f)
      shots.push({
        viewport: s.viewport,
        theme: s.theme,
        png: Buffer.from(f.bytes),
      });
  }
  return { ...out, shots };
}

// Automatic review of a page: desktop + mobile captures and axe
// audit (desktop), bounded by `timeoutMs`. Never an exception: a failure or a
// timeout becomes a warning, the update is not blocked.
export type PageReview = {
  shots: Shot[];
  a11y: A11yViolation[];
  errors: string[];
  warnings: string[];
};
export async function reviewPage(
  job: Omit<PageRenderJob, "viewport" | "audit">,
  timeoutMs = 30_000,
): Promise<PageReview> {
  const out: PageReview = { shots: [], a11y: [], errors: [], warnings: [] };
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((r) => {
    timer = setTimeout(() => r("timeout"), timeoutMs);
  });
  const shot = async (viewport: Viewport) => {
    try {
      const r = await Promise.race([
        render({ ...job, viewport, audit: viewport === "desktop" }),
        timeout,
      ]);
      if (r === "timeout") {
        out.warnings.push(
          `${viewport} capture skipped: review timed out after ${timeoutMs / 1000} s`,
        );
        return;
      }
      out.shots.push(...r.shots);
      out.a11y.push(...(r.a11y ?? []));
      out.errors.push(...r.errors);
    } catch (e) {
      out.warnings.push(
        `${viewport} capture failed: ${(e as Error).message.slice(0, 300)}`,
      );
    }
  };
  await Promise.all([shot("desktop"), shot("mobile")]);
  clearTimeout(timer);
  const rank = (s: Shot) => (s.viewport === "desktop" ? 0 : 1);
  out.shots.sort((a, b) => rank(a) - rank(b));
  return out;
}
