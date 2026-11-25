// Inactivity policy runner: the extension decision is applied (pause, warnedAt),
// a failing decision never stops the others, the default policy pauses nothing.
// Requires DATABASE_URL.
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { registerExtensions, resetExtensions, type InactivityInput } from "../extensions";
import { applyInactivityPolicy } from "./inactivity";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));
afterEach(resetExtensions);

async function workspace(name: string) {
  const [org] = await sql`insert into organizations (name) values (${name}) returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name, last_active_at)
      values (${org!.id}, 'main', now() - interval '20 days') returning id`;
  return ws!.id as string;
}
const state = async (id: string) =>
  (await sql`select paused_at, warned_at from workspaces where id = ${id}`)[0]!;

test("default policy pauses and warns nothing", async () => {
  const id = await workspace("inactivity-default");
  await applyInactivityPolicy();
  const s = await state(id);
  assert.equal(s.paused_at, null);
  assert.equal(s.warned_at, null);
});

test("pause, warn and none are applied; a failure does not stop the others", async () => {
  const [p, w, n, f] = await Promise.all(
    ["inactivity-pause", "inactivity-warn", "inactivity-none", "inactivity-fail"].map(workspace),
  );
  const seen: InactivityInput[] = [];
  registerExtensions({
    inactivity: {
      async decide(input) {
        seen.push(input);
        if (input.workspaceId === f) throw new Error("boom");
        return { action: input.workspaceId === p ? "pause" : input.workspaceId === w ? "warn" : "none" };
      },
    },
  });
  const now = new Date();
  const r = await applyInactivityPolicy(now);
  assert.ok(r.paused >= 1 && r.warned >= 1 && r.failed >= 1);
  assert.notEqual((await state(p!)).paused_at, null);
  assert.equal((await state(w!)).paused_at, null);
  assert.equal((await state(w!)).warned_at?.getTime(), now.getTime());
  assert.equal((await state(n!)).paused_at, null);
  assert.equal((await state(n!)).warned_at, null);
  const input = seen.find((i) => i.workspaceId === w)!;
  assert.equal(input.paused, false);
  assert.equal(input.warnedAt, null);
  assert.ok(Date.now() - new Date(input.lastActivityAt).getTime() > 19 * 86_400_000);

  // Paused workspaces are no longer asked; the warning is passed back.
  seen.length = 0;
  await applyInactivityPolicy();
  assert.ok(!seen.some((i) => i.workspaceId === p));
  assert.equal(seen.find((i) => i.workspaceId === w)!.warnedAt, now.toISOString());
});
