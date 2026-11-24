// BullMQ worker for the `render` queue: runs the capture in Chromium and
// stores the PNGs through the file driver; the job returns only their keys.
import { Worker, type Job } from "bullmq";
import { queueOptions } from "@getrunbase/core/bus";
import { env } from "@getrunbase/core/env";
import { componentsService } from "@getrunbase/core/components";
import { mockCall } from "@getrunbase/core/components/mock";
import { fileStorage } from "@getrunbase/core/files";
import {
  RENDER_QUEUE,
  jobWorkspace,
  shotKey,
  type RenderJob,
  type RenderResult,
  type ShotReport,
} from "@getrunbase/core/render";
import { componentScreenshot, pageScreenshot } from "./screenshot";

function run(job: RenderJob): Promise<ShotReport> {
  if (job.kind === "page") return pageScreenshot(job);
  const { data, ctx } = job;
  return componentScreenshot({
    ...job,
    call: async (method, args) =>
      data.mode === "live"
        ? componentsService.previewCall(ctx, data.perms, { method, args })
        : mockCall(data.data, String(method), args),
  });
}

export async function processRender(
  job: Job<RenderJob, RenderResult>,
): Promise<RenderResult> {
  const { shots, ...rest } = await run(job.data);
  const ws = jobWorkspace(job.data);
  const storage = fileStorage();
  const stored: RenderResult["shots"] = [];
  for (const s of shots) {
    const key = shotKey(ws, job.id!, s);
    await storage.put(key, { bytes: s.png, type: "image/png" });
    stored.push({ viewport: s.viewport, theme: s.theme, key });
  }
  return { ...rest, shots: stored };
}

export const startRenderWorker = (concurrency = env().RENDER_CONCURRENCY) =>
  new Worker<RenderJob, RenderResult>(RENDER_QUEUE, processRender, {
    ...queueOptions(),
    concurrency,
  });
