import { catalogService } from "@runbase/core/catalog";
import { route } from "@/lib/api-v1/http";

export const GET = route("getCatalogTemplate", ({ params }) =>
  catalogService.getTemplate(params.id),
);
