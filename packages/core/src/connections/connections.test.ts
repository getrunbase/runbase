// Integration test: requires DATABASE_URL, SECRETS_MASTER_KEY, BETTER_AUTH_SECRET
// and `deno` (connector manifests). The provider token endpoint is mocked.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import type { TenantContext } from "../tenant";
import {
  accessToken,
  connectionsService as svc,
  signState,
  verifyState,
  idTokenEmail,
} from "./index";
import { blocksService } from "../blocks";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
  setImmediate(() => process.exit(0));
});
process.env.RUNBASE_CONNECTORS_DIRS = fileURLToPath(
  new URL("../blocks/fixtures/connectors", import.meta.url),
);
process.env.OAUTH_ACME_CLIENT_ID = "cid";
process.env.OAUTH_ACME_CLIENT_SECRET = "csecret";
process.env.BETTER_AUTH_SECRET ??= "x".repeat(32);

async function owner(name: string): Promise<TenantContext> {
  const [org] =
    await sql`insert into organizations (name) values (${name}) returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'Default') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, ${name}, ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  return {
    organizationId: org!.id,
    workspaceId: ws!.id,
    actor: { userId: uid },
  };
}

const acme = { provider: "acme", tokenUrl: "https://auth.acme.test/token" };
const jwt = (claims: object) =>
  `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

test("state: signed, tampering and expiry refused", () => {
  const s = signState({
    provider: "acme",
    name: "a",
    userId: "u",
    organizationId: "o",
    workspaceId: "w",
  });
  assert.equal(verifyState(s).provider, "acme");
  assert.throws(() => verifyState(s.replace(/^./, "A")), /expired or invalid/);
  const old = signState(
    {
      provider: "acme",
      name: "a",
      userId: "u",
      organizationId: "o",
      workspaceId: "w",
    },
    -1,
  );
  assert.throws(() => verifyState(old), /expired or invalid/);
  assert.equal(idTokenEmail(jwt({ email: "a@b.co" })), "a@b.co");
  assert.equal(idTokenEmail("garbage"), null);
});

test("connect, refresh, isolate and disconnect", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  const a = await owner("CA");
  const b = await owner("CB");

  const [p] = await svc.providers(a);
  assert.deepEqual(p, {
    provider: "acme",
    scopes: ["read", "write"],
    nodes: ["Acme read", "Acme write"],
    types: ["node.acme.read", "node.acme.write"],
    configured: true,
  });

  const url = new URL(await svc.authorizeUrl(a, "acme", "work"));
  assert.equal(url.origin + url.pathname, "https://auth.acme.test/authorize");
  assert.equal(url.searchParams.get("scope"), "read write");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  const state = url.searchParams.get("state")!;

  // Another user cannot complete the flow.
  await assert.rejects(svc.complete(b, state, "code"), /expired or invalid/);

  const calls: URLSearchParams[] = [];
  let n = 0;
  globalThis.fetch = (async (u: string, init: RequestInit) => {
    const body = new URLSearchParams(String(init.body));
    calls.push(body);
    if (String(u).endsWith("/revoke")) return new Response("");
    n++;
    return Response.json({
      access_token: `at${n}`,
      ...(n === 1 && { refresh_token: "rt" }),
      // First token already expired: next read refreshes.
      expires_in: n === 1 ? 1 : 3600,
      id_token: jwt({ email: "ada@acme.test" }),
    });
  }) as typeof fetch;

  assert.deepEqual(await svc.complete(a, state, "code"), {
    provider: "acme",
    name: "work",
    popup: false,
  });
  assert.equal(calls[0]!.get("grant_type"), "authorization_code");
  assert.ok(calls[0]!.get("code_verifier"));
  assert.equal(calls[0]!.get("client_secret"), "csecret");

  const list = await svc.list(a);
  assert.equal(list.length, 1);
  assert.equal(list[0]!.account, "ada@acme.test");
  assert.ok(!("accessTokenEncrypted" in list[0]!));
  const [raw] =
    await sql`select access_token_encrypted as t from connections where id = ${list[0]!.id}`;
  assert.ok(!String(raw!.t).includes("at1"), "token stored in plain text");

  // Expired: refreshed with the stored refresh token, then reused.
  assert.equal(await accessToken(a, acme), "at2");
  assert.equal(calls[1]!.get("grant_type"), "refresh_token");
  assert.equal(calls[1]!.get("refresh_token"), "rt");
  assert.equal(await accessToken(a, acme, "work"), "at2");
  assert.equal(calls.length, 2);

  // Other workspace: nothing.
  await assert.rejects(accessToken(b, acme), /Connect a acme account first/);
  await assert.rejects(accessToken(a, acme, "nope"), /named nope/);

  // No name: the account email names the connection.
  const st2 = new URL(
    await svc.authorizeUrl(a, "acme", undefined, { popup: true }),
  ).searchParams.get("state")!;
  assert.deepEqual(await svc.complete(a, st2, "code2"), {
    provider: "acme",
    name: "ada@acme.test",
    popup: true,
  });
  assert.equal((await svc.list(a)).length, 2);
  await assert.rejects(accessToken(a, acme), /Several acme connections/);

  // Step form: dynamic choices run in the sandbox with the named connection;
  // the Picker token is the connection's own token.
  assert.deepEqual(
    await blocksService.options(a, "node.acme.read", "tab", {
      sheet: "q",
      connection: "work",
    }),
    [{ value: "q-1", label: "Tab 1" }],
  );
  await assert.rejects(
    blocksService.options(a, "node.acme.read", "sheet", {}),
    /no choices for sheet/,
  );
  await assert.rejects(
    blocksService.options(b, "node.acme.read", "tab", {}),
    /Connect a acme account first/,
  );
  assert.equal(await svc.accessToken(a, "acme", "work"), "at2");
  await assert.rejects(svc.accessToken(b, "acme", "work"), /named work/);

  await svc.remove(a, list[0]!.id);
  assert.equal(calls.at(-1)!.get("token"), "rt");
  assert.deepEqual(
    (await svc.list(a)).map((c) => c.name),
    ["ada@acme.test"],
  );
});

test("a member can connect an account, only an admin can disconnect", async () => {
  const a = await owner("CM");
  await sql`update memberships set role = 'member' where user_id = ${(a.actor as { userId: string }).userId}`;
  const url = new URL(await svc.authorizeUrl(a, "acme"));
  globalThis.fetch = (async () =>
    Response.json({ access_token: "m1", expires_in: 3600 })) as typeof fetch;
  await svc.complete(a, url.searchParams.get("state")!, "code");
  const [c] = await svc.list(a);
  await assert.rejects(svc.remove(a, c!.id), /admin/);
});
