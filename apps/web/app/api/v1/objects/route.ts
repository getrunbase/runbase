import { objectsService } from "@runbase/core/objects";
import { route } from "@/lib/api-v1/http";

export const GET = route("listObjects", async ({ ctx }) => ({
  data: await objectsService.list(ctx),
}));
