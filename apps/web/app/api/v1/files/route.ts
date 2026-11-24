import { filesService } from "@getrunbase/core/files";
import { route } from "@/lib/api-v1/http";

export const POST = route("uploadFile", async ({ ctx, body }) =>
  filesService.upload(ctx, {
    name: body.file.name,
    type: body.file.type || undefined,
    bytes: new Uint8Array(await body.file.arrayBuffer()),
  }),
);
