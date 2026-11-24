// Webhook test URL: signature checked, sample stored for the
// mapping, no event pushed (no workflow started). Capped read.
import { receiveWebhook } from "@runbase/core/webhooks";
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
  const res = await receiveWebhook(id, body, Object.fromEntries(req.headers), {
    test: true,
  });
  return Response.json(res.body, { status: res.status });
}
