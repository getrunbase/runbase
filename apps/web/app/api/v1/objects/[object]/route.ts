import { objectOf, route } from "@/lib/api-v1/http";

export const GET = route("getObject", ({ ctx, params }) =>
  objectOf(ctx, params.object),
);
