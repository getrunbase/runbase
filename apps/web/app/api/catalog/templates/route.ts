// Public catalog: template search, no API key.
import { catalogService } from "@runbase/core/catalog";
import { route } from "@/lib/api-v1/http";

export const GET = route("listCatalogTemplates", ({ query }) =>
  catalogService.searchTemplates(query),
);
