// Switch block: requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { objectsService } from "../../objects";
import { recordsService } from "../../records";
import type { TenantContext } from "../../tenant";
import { workflowsService } from "../../workflows";
import { blocksService } from "../index";

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

test("switch: first matching case, Else, relation", async () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  const ctx = await owner("Switch");
  const company = await objectsService.create(ctx, {
    slug: "company",
    name: "Company",
    fields: [{ key: "size", label: "Taille", type: "number" }],
  });
  const deal = await objectsService.create(ctx, {
    slug: "deal",
    name: "Deal",
    fields: [
      {
        key: "stage",
        label: "Stage",
        type: "select",
        options: ["new", "gagne", "lost"],
      },
      {
        key: "company",
        label: "Company",
        type: "ref",
        object: "company",
      },
    ],
  });
  const { record: big } = await recordsService.upsert(ctx, {
    objectId: company.id,
    data: { size: 500 },
  });
  const make = async (data: Record<string, unknown>) =>
    (await recordsService.upsert(ctx, { objectId: deal.id, data })).record.id;
  const won = await make({ stage: "gagne" });
  const fresh = await make({ stage: "new" });
  const bigDeal = await make({ stage: "lost", company: big.id });

  const step = (field: string, cases: unknown[]) => ({
    trigger: { type: "trigger.manual", object: "deal" },
    steps: [
      {
        id: "s",
        type: "switch",
        input: { object: "deal", recordId: "{{record.id}}", field, cases },
      },
      { id: "a", type: "wait", input: { duration: "1s" } },
    ],
    next: { s: { c1: ["a"] } },
  });
  const byStage = step("stage", [
    { id: "c1", label: "Won", op: "eq", value: "gagne" },
    { id: "c2", label: "Perdu", op: "eq", value: "lost" },
  ]);
  // Dynamic branches: one per case + Else; branch without a follow-up is valid.
  assert.deepEqual(await workflowsService.validate(ctx, byStage), []);
  const bad = step("inconnu", [{ id: "c1", label: "X", op: "eq", value: 1 }]);
  assert.ok((await workflowsService.validate(ctx, bad)).length > 0);
  const unknownBranch = { ...byStage, next: { s: { zz: ["a"] } } };
  assert.ok(
    (await workflowsService.validate(ctx, unknownBranch)).includes(
      "s: unknown branch zz (valid: c1, c2, else)",
    ),
  );
  // `default` / `otherwise` (common agent guesses): fix suggested.
  const defaultBranch = { ...byStage, next: { s: { default: ["a"] } } };
  assert.ok(
    (await workflowsService.validate(ctx, defaultBranch)).includes(
      "s: no branch default, the fallback branch is named else (rename next.s.default to next.s.else)",
    ),
  );

  const branchOf = async (def: typeof byStage, id: string) =>
    (await workflowsService.dryRun(ctx, def, [id]))[0]!.path[0]!.branch;
  assert.equal(await branchOf(byStage, won), "c1");
  assert.equal(await branchOf(byStage, fresh), "else");

  const bySize = step("company.size", [
    { id: "c1", label: "Grand account", op: "gt", value: 50 },
  ]);
  assert.deepEqual(await workflowsService.validate(ctx, bySize), []);
  assert.equal(await branchOf(bySize, bigDeal), "c1");
  assert.equal(await branchOf(bySize, won), "else");

  const listed = (await blocksService.list()).find((b) => b.type === "switch");
  assert.equal(listed?.dynamicBranches, true);
});
