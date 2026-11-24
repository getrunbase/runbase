// Integration test: requires DATABASE_URL.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mockOutbox } from "../email";

after(() => setImmediate(() => process.exit(0))); // closes the postgres pool

const BASE = "http://localhost:3000/api/auth";

// Requests a magic link; returns the HTTP response of the request.
async function request(email: string, name?: string) {
  const { auth } = await import("./index");
  return auth.handler(
    new Request(`${BASE}/sign-in/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, name, callbackURL: "/" }),
    }),
  );
}

// Opens the last link received by `email`; returns the session cookie.
async function open(email: string) {
  const { auth } = await import("./index");
  const mail = [...mockOutbox].reverse().find((m) => m.to.includes(email))!;
  const url = mail.text.match(/https?:\/\/\S+/)![0];
  const res = await auth.handler(new Request(url));
  return res.headers.get("set-cookie")?.split(";")[0];
}

test("magic link: sign-up, session via cookie, single-use link", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  const { auth } = await import("./index");
  process.env.SIGNUPS_ENABLED = "true";
  const email = `${crypto.randomUUID()}@x.io`;
  assert.equal((await request(email, "a")).status, 200);
  const mail = [...mockOutbox].reverse().find((m) => m.to.includes(email))!;
  const cookie = await open(email);
  assert.ok(cookie);
  const session = await auth.api.getSession({
    headers: new Headers({ cookie: cookie! }),
  });
  assert.equal(session?.user.email, email);
  // Replaying the same link: no new session.
  const url = mail.text.match(/https?:\/\/\S+/)![0];
  const again = await auth.handler(new Request(url));
  assert.match(again.headers.get("location") ?? "", /error=/);
});

test("sign-ups closed: 200 for an unknown user (no enumeration), link sent to an existing account; organization on sign-up", async () => {
  const { db } = await import("./index");
  const { eq } = await import("drizzle-orm");
  const { memberships, user, workspaces } = await import("../db/schema");

  process.env.SIGNUPS_ENABLED = "false";
  const unknown = `${crypto.randomUUID()}@x.io`;
  assert.equal((await request(unknown)).status, 200);
  assert.ok(!mockOutbox.some((m) => m.to.includes(unknown)));

  process.env.SIGNUPS_ENABLED = "true";
  const email = `${crypto.randomUUID()}@x.io`;
  await request(email, "b");
  assert.ok(await open(email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  assert.equal(u?.name, "b");
  const [m] = await db
    .select()
    .from(memberships)
    .where(eq(memberships.userId, u!.id));
  assert.equal(m?.role, "owner");
  const ws = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.organizationId, m!.organizationId));
  assert.equal(ws.length, 1);

  // Existing account (e.g. invited): accepted even with signups closed.
  process.env.SIGNUPS_ENABLED = "false";
  assert.equal((await request(email)).status, 200);
});

test("name derived from email: business domain, else local part", async () => {
  const { nameFromEmail } = await import("./index");
  assert.equal(nameFromEmail("alex@acme.io"), "Acme");
  assert.equal(nameFromEmail("alex@gmail.com"), "Alex");
});
