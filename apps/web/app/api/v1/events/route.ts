import { eventsService } from "@getrunbase/core/events";
import { route } from "@/lib/api-v1/http";

export const GET = route("listEvents", async ({ ctx, query }) => {
  const { after, ...filter } = query;
  const page = await eventsService.list(ctx, { ...filter, cursor: after });
  return { data: page.items, next: page.nextCursor };
});

// Duplicate (same idempotencyKey): existing event, status 200.
export const POST = route("pushEvent", async ({ ctx, body }) => {
  const { occurredAt, ...input } = body;
  const event = await eventsService.insert(ctx, {
    ...input,
    occurredAt: occurredAt ? new Date(occurredAt) : undefined,
    source: "api",
  });
  return Response.json(event, { status: event.duplicate ? 200 : 201 });
});
