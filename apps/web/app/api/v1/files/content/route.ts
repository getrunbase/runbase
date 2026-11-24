import { filesService } from "@getrunbase/core/files";
import { route } from "@/lib/api-v1/http";

export const GET = route("downloadFile", async ({ ctx, query }) => {
  const file = await filesService.download(ctx, query.key);
  return new Response(Buffer.from(file.bytes), {
    headers: {
      "content-type": file.type || "application/octet-stream",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "x-content-type-options": "nosniff",
    },
  });
});
