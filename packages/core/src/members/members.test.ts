// Integration test: requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { resolveUserContext, type TenantContext } from "../tenant";
import { workspacesService } from "../workspaces";
import { mockOutbox } from "../email";
import { recordsService } from "../records";
import { objectsService } from "../objects";
import { answerInvitation, membersService, pendingInvitations } from "./index";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));

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

test("workspaces CRUD, switch and invitation limited to the organization", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  const a = await owner("A");
  const b = await owner("B");

  const ws2 = await workspacesService.create(a, "Second");
  await workspacesService.rename(a, ws2.id, "Renamed");
  assert.deepEqual(
    (await workspacesService.list(a)).map((w) => w.name),
    ["Default", "Renamed"],
  );
  // Switch workspace
  const switched = await resolveUserContext(
    (a.actor as { userId: string }).userId,
    ws2.id,
  );
  assert.equal(switched!.workspaceId, ws2.id);
  // A workspace of another org cannot be selected
  const other = await resolveUserContext(
    (a.actor as { userId: string }).userId,
    b.workspaceId,
  );
  assert.equal(other!.organizationId, a.organizationId);

  await workspacesService.remove(a, ws2.id);
  await assert.rejects(
    workspacesService.remove(a, a.workspaceId),
    /last workspace/,
  );

  // Invitation
  const email = `${crypto.randomUUID()}@invite.io`;
  assert.ok(await membersService.invite(a, { email }));
  const [u] = await sql`select id from "user" where email = ${email}`;
  // Pending: no access, a (simulated) email goes out with the links.
  assert.equal(await resolveUserContext(u!.id), null);
  assert.match(mockOutbox.at(-1)!.text, /\/invitations/);
  assert.deepEqual(mockOutbox.at(-1)!.to, [email]);
  assert.equal((await pendingInvitations(u!.id)).length, 1);
  // Unverified address: acceptance refused, invitation stays pending.
  await assert.rejects(
    answerInvitation(u!.id, a.organizationId, true),
    /Verify your email/,
  );
  assert.equal((await pendingInvitations(u!.id)).length, 1);
  await sql`update "user" set email_verified = true where id = ${u!.id}`;
  await answerInvitation(u!.id, a.organizationId, true);
  assert.equal((await pendingInvitations(u!.id)).length, 0);
  const ctx = await resolveUserContext(u!.id);
  assert.equal(ctx!.organizationId, a.organizationId);
  assert.deepEqual(
    (await workspacesService.list(ctx!)).map((w) => w.id),
    [a.workspaceId],
  );
  await assert.rejects(
    workspacesService.list({ ...b, actor: ctx!.actor }),
    /Access denied/,
  );
  // A plain member cannot invite
  await assert.rejects(membersService.invite(ctx!, { email: "x@y.io" }), {
    kind: "forbidden",
  });
});

test("a member gets 403 on create/rename/remove, an admin passes", async () => {
  const o = await owner("C");
  const role = async (r: "admin" | "member"): Promise<TenantContext> => {
    const uid = crypto.randomUUID();
    await sql`insert into "user" (id, name, email) values (${uid}, ${r}, ${uid + "@x.io"})`;
    await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${o.organizationId}, ${r})`;
    return { ...o, actor: { userId: uid } };
  };
  const member = await role("member");
  const admin = await role("admin");
  const ws2 = await workspacesService.create(o, "Target");

  const forbidden = { kind: "forbidden" };
  await assert.rejects(workspacesService.create(member, "X"), forbidden);
  await assert.rejects(
    workspacesService.rename(member, ws2.id, "X"),
    forbidden,
  );
  await assert.rejects(workspacesService.remove(member, ws2.id), forbidden);
  assert.equal((await workspacesService.list(member)).length, 2);

  const ws3 = await workspacesService.create(admin, "Admin");
  await workspacesService.rename(admin, ws3.id, "Admin 2");
  assert.equal((await workspacesService.remove(admin, ws2.id)).length, 1);
});

test("members: list, role, removal; viewer read-only", async () => {
  const o = await owner("D");
  const email = `${crypto.randomUUID()}@invite.io`;
  await membersService.invite(o, { email, role: "viewer" });
  let list = await membersService.list(o);
  const inv = list.find((m) => m.email === email)!;
  assert.equal(inv.pending, true);
  assert.equal(inv.role, "viewer");
  await sql`update "user" set email_verified = true where id = ${inv.userId}`;
  // Refusal: the invitation disappears.
  await answerInvitation(inv.userId, o.organizationId, false);
  assert.equal((await membersService.list(o)).length, 1);
  await assert.rejects(
    answerInvitation(inv.userId, o.organizationId, true),
    /not found/,
  );

  await membersService.invite(o, { email, role: "viewer" });
  const [u] = await sql`select id from "user" where email = ${email}`;
  await answerInvitation(u!.id, o.organizationId, true);
  const viewer = { ...o, actor: { userId: u!.id as string } };
  const note = await objectsService.create(o, {
    slug: "note",
    name: "Note",
    fields: [{ key: "t", label: "T", type: "text" }],
  });
  // Viewer: reads, does not write.
  assert.equal((await recordsService.search(viewer, note.id)).length, 0);
  await assert.rejects(
    recordsService.upsert(viewer, { objectId: note.id, data: { t: "x" } }),
    { kind: "forbidden" },
  );
  // Switched to member: writes.
  list = await membersService.list(o);
  const m = list.find((x) => x.email === email)!;
  await membersService.setRole(o, m.id, "member");
  await recordsService.upsert(viewer, { objectId: note.id, data: { t: "x" } });
  // The owner can neither demote nor remove themselves.
  const own = list.find((x) => x.role === "owner")!;
  await assert.rejects(membersService.setRole(o, own.id, "viewer"), {
    kind: "forbidden",
  });
  await assert.rejects(membersService.remove(o, own.id), { kind: "forbidden" });
  // A member does not manage members; removed, they lose access.
  await assert.rejects(membersService.setRole(viewer, own.id, "admin"), {
    kind: "forbidden",
  });
  await membersService.remove(o, m.id);
  await assert.rejects(recordsService.search(viewer, note.id), /Access denied/);
});
