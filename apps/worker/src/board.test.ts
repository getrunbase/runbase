// Integration test: requires DATABASE_URL and REDIS_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";

process.env.SIGNUPS_ENABLED = "true";
const { auth } = await import("@getrunbase/core/auth");
const { createBoardApp } = await import("./board");
const { mockOutbox } = await import("@getrunbase/core/email");

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));

async function cookie(role?: "member", email = `${crypto.randomUUID()}@x.io`) {
  // Magic link (simulated): request then open the received link.
  await auth.api.signInMagicLink({
    body: { email, name: "B", callbackURL: "/" },
    headers: new Headers(),
  });
  const link = [...mockOutbox].reverse().find((m) => m.to.includes(email))!;
  const res = await auth.handler(
    new Request(link.text.match(/https?:\/\/\S+/)![0]),
  );
  if (role)
    await sql`update memberships set role = ${role} where user_id = (select id from "user" where email = ${email})`;
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

test("Bull Board restricted to platform admins", async () => {
  const app = createBoardApp();
  const get = (path: string, c?: string) =>
    app.request(path, { headers: c ? { cookie: c } : {} });

  assert.equal((await get("/admin/queues")).status, 401);
  assert.equal((await get("/admin/queues/api/queues")).status, 401);
  const member = await cookie("member");
  assert.equal((await get("/admin/queues", member)).status, 403);
  assert.equal((await get("/admin/queues/api/queues", member)).status, 403);

  // Every sign-up owns their organization: not listed, refused.
  const admin = `${crypto.randomUUID()}@x.io`;
  const owner = await cookie();
  delete process.env.PLATFORM_ADMIN_EMAILS;
  assert.equal((await get("/admin/queues", owner)).status, 403);
  process.env.PLATFORM_ADMIN_EMAILS = `autre@x.io, ${admin.toUpperCase()}`;
  assert.equal((await get("/admin/queues", owner)).status, 403);
  assert.equal((await get("/admin/queues/api/queues", owner)).status, 403);

  const listed = await cookie(undefined, admin);
  assert.equal((await get("/admin/queues", listed)).status, 200);
  const api = await get("/admin/queues/api/queues", listed);
  assert.equal(api.status, 200);
  const names = ((await api.json()) as { queues: { name: string }[] }).queues
    .map((q) => q.name)
    .sort();
  assert.deepEqual(names, ["bus", "workflow-runs", "workflow-schedules"]);
});

test("/healthz reflects worker liveness without authentication", async () => {
  let healthy = true;
  const app = createBoardApp(() => healthy);
  const up = await app.request("/healthz");
  assert.equal(up.status, 200);
  assert.deepEqual(await up.json(), { status: "ok" });
  healthy = false;
  assert.equal((await app.request("/healthz")).status, 503);
});
