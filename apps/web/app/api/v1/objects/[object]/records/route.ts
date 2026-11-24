import { recordsService } from "@getrunbase/core/records";
import { objectOf, route } from "@/lib/api-v1/http";

// Keyset on the id: `after` = `next` of the previous page.
export const GET = route("listRecords", async ({ ctx, params, query }) => {
  const object = await objectOf(ctx, params.object);
  const page = await recordsService.searchPage(ctx, object.id, {
    q: query.q,
    pagination: { limit: query.limit, after: query.after },
  });
  return { data: page.records, next: page.next, total: page.total };
});

// Upsert: 201 on creation, 200 on an existing record.
export const POST = route("createRecord", async ({ ctx, params, body }) => {
  const object = await objectOf(ctx, params.object);
  const { record, created } = await recordsService.upsert(ctx, {
    ...body,
    objectId: object.id,
  });
  return Response.json({ record, created }, { status: created ? 201 : 200 });
});
