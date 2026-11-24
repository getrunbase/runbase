// Public OpenAPI spec (no key), generated from the zod schemas.
import { openapi } from "@/lib/api-v1/openapi";

export const dynamic = "force-static";

export const GET = () => Response.json(openapi());
