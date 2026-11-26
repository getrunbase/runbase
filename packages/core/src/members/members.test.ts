// Integration test: requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import {
  accessibleWorkspaces,
  invalidateWorkspaceAccess,
  resolveMcpContext,
  resolveUserContext,
  resolveUserSession,
  type TenantContext,
} from "../tenant";
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
  assert.ok(await membersService.invite(a, { email, workspaceIds: [a.workspaceId] }));
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
  await assert.rejects(membersService.invite(ctx!, { email: "x@y.io", workspaceIds: null }), {
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
  await membersService.invite(o, {
    email,
    role: "viewer",
    workspaceIds: [o.workspaceId],
  });
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

  await membersService.invite(o, {
    email,
    role: "viewer",
    workspaceIds: [o.workspaceId],
  });
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

// Invited member, verified address, accepted invitation.
async function accept(o: TenantContext, email: string) {
  const [u] = await sql`select id from "user" where email = ${email}`;
  await sql`update "user" set email_verified = true where id = ${u!.id}`;
  await answerInvitation(u!.id, o.organizationId, true);
  return { ...o, actor: { userId: u!.id as string } };
}
const mine = (o: TenantContext, email: string) =>
  membersService.list(o).then((l) => l.find((m) => m.email === email)!);

test("invitation scoped to one workspace: no access to the others", async () => {
  const o = await owner("Scoped");
  const ws2 = await workspacesService.create(o, "Other");
  const email = `${crypto.randomUUID()}@invite.io`;
  await membersService.invite(o, { email, workspaceIds: [o.workspaceId] });
  assert.match(mockOutbox.at(-1)!.text, /workspaces: Default/);
  const m = await accept(o, email);
  const uid = m.actor.userId;
  // Service level: only its workspace is listed.
  assert.deepEqual(
    (await workspacesService.list(m)).map((w) => w.id),
    [o.workspaceId],
  );
  // Tenant level: the other workspace is refused, even by explicit id (URL, cookie).
  await assert.rejects(
    workspacesService.list({ ...m, workspaceId: ws2.id }),
    /Access denied/,
  );
  const session = await resolveUserSession(uid, ws2.id);
  assert.equal(session!.ctx.workspaceId, o.workspaceId);
  assert.deepEqual(
    session!.workspaces.map((w) => w.id),
    [o.workspaceId],
  );
  // MCP: accessible workspaces and explicit selection.
  const p = { key: `user:${uid}`, actor: m.actor };
  invalidateWorkspaceAccess();
  assert.deepEqual(
    (await accessibleWorkspaces(p)).map((w) => w.id),
    [o.workspaceId],
  );
  await assert.rejects(resolveMcpContext(p, ws2.id), { kind: "forbidden" });
  // The owner still sees everything.
  assert.equal((await workspacesService.list(o)).length, 2);
});

test("second invitation before acceptance merges the workspaces", async () => {
  const o = await owner("Merge");
  const ws2 = await workspacesService.create(o, "Second");
  const email = `${crypto.randomUUID()}@invite.io`;
  await membersService.invite(o, { email, role: "viewer", workspaceIds: [o.workspaceId] });
  await membersService.invite(o, { email, role: "member", workspaceIds: [ws2.id] });
  const inv = await mine(o, email);
  assert.equal(inv.pending, true);
  assert.equal(inv.role, "member");
  assert.deepEqual(new Set(inv.workspaceIds), new Set([o.workspaceId, ws2.id]));
  // The invitation email is resent with both workspaces.
  assert.deepEqual(mockOutbox.at(-1)!.to, [email]);
  assert.match(mockOutbox.at(-1)!.text, /Default, Second|Second, Default/);
  assert.equal((await membersService.list(o)).length, 2);
  const m = await accept(o, email);
  assert.deepEqual(
    (await workspacesService.list(m)).map((w) => w.id).sort(),
    [o.workspaceId, ws2.id].sort(),
  );
  // Merge with "all workspaces": null wins.
  await membersService.invite(o, { email, workspaceIds: null });
  assert.equal((await mine(o, email)).workspaceIds, null);
});

test("invitation after acceptance merges and sends an access email", async () => {
  const o = await owner("After");
  const ws2 = await workspacesService.create(o, "Later");
  const email = `${crypto.randomUUID()}@invite.io`;
  await membersService.invite(o, { email, role: "viewer", workspaceIds: [o.workspaceId] });
  const m = await accept(o, email);
  await assert.rejects(
    workspacesService.list({ ...m, workspaceId: ws2.id }),
    /Access denied/,
  );
  await membersService.invite(o, { email, role: "admin", workspaceIds: [ws2.id] });
  assert.match(mockOutbox.at(-1)!.text, /You now have access to Later/);
  const after = await mine(o, email);
  // Accepted: the role does not change through an invitation.
  assert.equal(after.role, "viewer");
  assert.equal(after.pending, false);
  assert.equal((await workspacesService.list({ ...m, workspaceId: ws2.id })).length, 2);
});

test("owners and admins always access every workspace", async () => {
  const o = await owner("Admins");
  const email = `${crypto.randomUUID()}@invite.io`;
  await membersService.invite(o, { email, role: "admin", workspaceIds: [o.workspaceId] });
  const inv = await mine(o, email);
  assert.equal(inv.workspaceIds, null);
  await assert.rejects(
    membersService.setWorkspaces(o, inv.id, [o.workspaceId]),
    /every workspace/,
  );
  const own = (await membersService.list(o)).find((m) => m.role === "owner")!;
  assert.equal(own.workspaceIds, null);
  // Promotion to admin resets the access to all workspaces.
  const e2 = `${crypto.randomUUID()}@invite.io`;
  await membersService.invite(o, { email: e2, workspaceIds: [o.workspaceId] });
  await membersService.setRole(o, (await mine(o, e2)).id, "admin");
  assert.equal((await mine(o, e2)).workspaceIds, null);
});

test("foreign or empty workspace lists are refused", async () => {
  const o = await owner("Foreign");
  const b = await owner("Elsewhere");
  const email = `${crypto.randomUUID()}@invite.io`;
  await assert.rejects(
    membersService.invite(o, { email, workspaceIds: [b.workspaceId] }),
    { kind: "invalid_input" },
  );
  await assert.rejects(
    membersService.invite(o, { email, workspaceIds: [] }),
    { kind: "invalid_input" },
  );
  assert.equal((await membersService.list(o)).length, 1);
  await membersService.invite(o, { email, workspaceIds: [o.workspaceId] });
  await assert.rejects(
    membersService.setWorkspaces(o, (await mine(o, email)).id, [b.workspaceId]),
    { kind: "invalid_input" },
  );
});

test("setWorkspaces changes access; deleting a workspace prunes the lists", async () => {
  const o = await owner("Set");
  const ws2 = await workspacesService.create(o, "Two");
  const email = `${crypto.randomUUID()}@invite.io`;
  await membersService.invite(o, { email, workspaceIds: [o.workspaceId] });
  const m = await accept(o, email);
  const id = (await mine(o, email)).id;
  // A member does not change access.
  await assert.rejects(membersService.setWorkspaces(m, id, null), {
    kind: "forbidden",
  });
  await membersService.setWorkspaces(o, id, [o.workspaceId, ws2.id]);
  assert.equal((await workspacesService.list({ ...m, workspaceId: ws2.id })).length, 2);
  const [log] =
    await sql`select diff from audit_log where action = 'member.workspaces' and resource_id = ${id}`;
  assert.ok(log);
  await membersService.setWorkspaces(o, id, [ws2.id]);
  await assert.rejects(workspacesService.list(m), /Access denied/);
  // Active workspace removed: the session falls back to an allowed one.
  const s = await resolveUserSession(m.actor.userId, o.workspaceId);
  assert.equal(s!.ctx.workspaceId, ws2.id);

  await membersService.setWorkspaces(o, id, [o.workspaceId, ws2.id]);
  const [k] =
    await sql`insert into api_keys (name, scopes, workspace_ids, organization_id, key_hash)
      values ('k', '{read}', ${[o.workspaceId, ws2.id]}::uuid[], ${o.organizationId}, ${crypto.randomUUID()}) returning id`;
  await workspacesService.remove(o, ws2.id);
  assert.deepEqual((await mine(o, email)).workspaceIds, [o.workspaceId]);
  const [key] = await sql`select workspace_ids from api_keys where id = ${k!.id}`;
  assert.deepEqual(key!.workspace_ids, [o.workspaceId]);
  // Null stays null.
  await membersService.setWorkspaces(o, id, null);
  assert.equal((await mine(o, email)).workspaceIds, null);
});
