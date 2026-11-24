import { notFound } from "@runbase/core/errors";
import { recordsService } from "@runbase/core/records";
import { route } from "@/lib/api-v1/http";

export const GET = route("getRecord", ({ ctx, params }) =>
  recordsService.get(ctx, params.id),
);

export const PATCH = route(
  "updateRecord",
  async ({ ctx, params, body }) =>
    (await recordsService.update(ctx, params.id, body.data, body.mode)).record,
);

export const DELETE = route("deleteRecord", async ({ ctx, params }) => {
  if (!(await recordsService.remove(ctx, params.id)))
    throw notFound("records.notFound", "Record not found");
});
