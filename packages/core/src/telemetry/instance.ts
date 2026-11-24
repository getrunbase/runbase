// Instance data for anonymous telemetry: random persistent
// id (Redis, AOF in self-host) and raw global counters. No
// tenant data: only count(*), bucketed by the caller.
import { randomUUID } from "node:crypto";
import { count } from "drizzle-orm";
import { busConnection } from "../bus";
import { db } from "../db/client";
import { workflowRuns, workflows, workspaces } from "../db/schema";

const INSTANCE_KEY = "runbase:instance-id";

export async function instanceId(): Promise<string> {
  const redis = busConnection();
  try {
    // SET NX: the first startup sets the id, the following ones read it back.
    await redis.set(INSTANCE_KEY, randomUUID(), "NX");
    return (await redis.get(INSTANCE_KEY))!;
  } finally {
    redis.disconnect();
  }
}

export async function instanceCounts() {
  const [[ws], [wf], [runs]] = await Promise.all([
    db.select({ n: count() }).from(workspaces),
    db.select({ n: count() }).from(workflows),
    db.select({ n: count() }).from(workflowRuns),
  ]);
  return { workspaces: ws!.n, workflows: wf!.n, runs: runs!.n };
}
