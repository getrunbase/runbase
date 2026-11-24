import { exportStream, objectsService } from "@runbase/core/objects";
import { getTranslations } from "next-intl/server";
import { getTenant } from "@/lib/tenant";

// Download of all records of an object (CSV or JSON), streamed:
// objects.export pages are sent as they come.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const { ctx } = await getTenant();
  const object = await objectsService.get(ctx, slug);
  if (!object) {
    const t = await getTranslations("objects.export");
    return new Response(t("notFound"), { status: 404 });
  }
  const format =
    new URL(req.url).searchParams.get("format") === "json" ? "json" : "csv";
  const chunks = exportStream(ctx, object.id, format);
  const enc = new TextEncoder();
  const body = new ReadableStream({
    async pull(c) {
      const { value, done } = await chunks.next();
      if (done) c.close();
      else c.enqueue(enc.encode(value));
    },
  });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: {
      "content-type":
        format === "json"
          ? "application/json; charset=utf-8"
          : "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${object.slug}-${date}.${format}"`,
    },
  });
}
