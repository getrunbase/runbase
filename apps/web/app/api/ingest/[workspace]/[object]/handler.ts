// Ingestion: HTTP adapter, the logic lives in @runbase/core/ingest.
// Body read with a cap (413 beyond BODY_MAX_BYTES) then passed raw: the JSON
// is parsed only after the key is authenticated.
import { ingest } from "@runbase/core/ingest";
import { BodyTooLarge, readBounded, tooLarge } from "@/lib/request-limits";

type Params = Promise<{ workspace: string; object: string }>;

export const handler =
  (batch: boolean, csv = false) =>
  async (req: Request, { params }: { params: Params }) => {
    const { workspace, object } = await params;
    let rawBody: string;
    try {
      rawBody = await readBounded(req);
    } catch (e) {
      if (e instanceof BodyTooLarge) return tooLarge();
      throw e;
    }
    const auth = req.headers.get("authorization");
    const res = await ingest({
      apiKey: auth?.startsWith("Bearer ") ? auth.slice(7) : null,
      workspaceId: workspace,
      objectSlug: object,
      body: undefined,
      rawBody,
      batch,
      csv,
      idempotencyKey: req.headers.get("idempotency-key"),
    });
    return Response.json(res.body, { status: res.status });
  };
