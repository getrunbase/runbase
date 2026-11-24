// Web layout navigation data: databases, objects, pages
// (published, or all for a builder) and counters, in one transaction and a
// single query (instead of one withTenant per service and per scope check).
import { sql } from "drizzle-orm";
import type { Role } from "../members";
import { withTenant, type TenantContext } from "../tenant";

export type NavData = {
  databases: { id: string; name: string; slug: string }[];
  objects: { databaseId: string | null; name: string; slug: string }[];
  pages: { id: string; name: string; icon: string | null }[];
  openErrors: number;
  waitingApprovals: number;
};

type Row = NavData;

// Never published pages: visible to builders only (and API keys).
const builder = (role: Role | null) =>
  !role || role === "owner" || role === "admin" || role === "member";

export async function loadNavData(
  ctx: TenantContext,
  role: Role | null,
): Promise<NavData> {
  const ws = ctx.workspaceId;
  const [row] = await withTenant(ctx, (tx) =>
    tx.execute<Row>(sql`select
      (select coalesce(json_agg(json_build_object('id', d.id, 'name', d.name, 'slug', d.slug)
        order by d.created_at), '[]') from databases d where d.workspace_id = ${ws}) as databases,
      (select coalesce(json_agg(json_build_object('databaseId', o.database_id, 'name', o.name,
        'slug', o.slug) order by o.created_at), '[]') from objects o where o.workspace_id = ${ws}) as objects,
      (select coalesce(json_agg(json_build_object('id', p.id, 'name', p.name, 'icon', p.icon)
        order by p.created_at), '[]') from pages p where p.workspace_id = ${ws}
        and (${builder(role)}::boolean or p.current_version is not null)) as pages,
      (select count(*)::int from errors e where e.workspace_id = ${ws}
        and e.status = 'open') as "openErrors",
      (select count(*)::int from workflow_runs r where r.workspace_id = ${ws}
        and r.status = 'waiting') as "waitingApprovals"`),
  );
  return row!;
}
