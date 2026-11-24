import { databasesService } from "@runbase/core/databases";
import { objectsService } from "@runbase/core/objects";
import type { TenantContext } from "@runbase/core/tenant";
import type { Target } from "./schema-editor";

// Relation target objects: all those of the workspace, all databases.
export async function relationTargets(ctx: TenantContext): Promise<Target[]> {
  const [dbs, objs] = await Promise.all([
    databasesService.list(ctx),
    objectsService.list(ctx),
  ]);
  const names = new Map(dbs.map((d) => [d.id, d.name]));
  return objs.map((o) => ({
    slug: o.slug,
    name: o.name,
    database: names.get(o.databaseId) ?? "",
  }));
}
