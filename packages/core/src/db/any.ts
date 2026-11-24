import { sql, type SQLWrapper } from "drizzle-orm";

// `col = any($1::uuid[])`: a single parameter whatever the
// number of ids, where inArray creates one per id (refused by Postgres beyond
// 65535). Empty list: no rows.
export const anyUuid = (col: SQLWrapper, ids: readonly string[]) =>
  sql`${col} = any(${`{${ids.map((i) => `"${i.replace(/["\\]/g, "\\$&")}"`).join(",")}}`}::uuid[])`;
