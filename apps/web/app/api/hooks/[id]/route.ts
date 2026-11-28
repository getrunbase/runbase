// Signed incoming webhooks: HTTP adapter, the logic lives in
// @getrunbase/core/webhooks. Raw body: the signature covers the received bytes.
// Capped read: beyond BODY_MAX_BYTES, 413.
import { checkWebhookMapping } from "@getrunbase/core/triggers";
import { receiveWebhook } from "@getrunbase/core/webhooks";
import { BodyTooLarge, readBounded, tooLarge } from "@/lib/request-limits";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: string;
  try {
    body = await readBounded(req);
  } catch (e) {
    if (e instanceof BodyTooLarge) return tooLarge();
    throw e;
  }
  // Mapping checked before the event is stored: 422 on an unresolved match
  // field, `warnings` in the 200 body otherwise.
  const res = await receiveWebhook(id, body, Object.fromEntries(req.headers), {
    check: checkWebhookMapping,
  });
  return Response.json(res.body, { status: res.status });
}
