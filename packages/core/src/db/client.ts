import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { env } from "../env";
import { observePool } from "../telemetry";

// Pool options: size configurable by env variable, and
// named prepared statements disabled (PG_PREPARE=false) behind PgBouncer in
// transaction mode, where two transactions do not land on the same backend.
export const poolOptions = (max: number) => ({
  max,
  prepare: env().PG_PREPARE,
});

// A single pool per process: in dev, Next instantiates this module once per
// route and per layer (RSC, actions…), which saturated max_connections.
const g = globalThis as {
  __runbaseSql?: ReturnType<typeof postgres>;
  __runbaseQueryHooks?: Set<(query: string) => void>;
};
const hooks = (g.__runbaseQueryHooks ??= new Set());

// Observes each query sent to the server (tests that count SQL
// round trips). Returns the unsubscribe function.
export function onQuery(fn: (query: string) => void) {
  hooks.add(fn);
  return () => void hooks.delete(fn);
}

// Lazy connection: no query before the first call (Next build without DB).
g.__runbaseSql ??= postgres(env().DATABASE_URL!, {
  ...poolOptions(env().PG_POOL_MAX),
  debug: (_conn, query) => {
    for (const h of hooks) h(query);
  },
});
observePool("main", g.__runbaseSql);
export const db = drizzle(g.__runbaseSql, { schema });
