// Catalog templates (templates/*): each one imports into a
// blank workspace, its workflows are valid (`node.<id>` blocks of the
// repo connectors included) and a dry run on a test record passes
// without error (no external call). Requires DATABASE_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import type { TenantContext } from "../tenant";
import { objectsService } from "../objects";
import { recordsService } from "../records";
import { workflowsService } from "../workflows";
import { templatesService } from "./index";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
after(() => setImmediate(() => process.exit(0)));

const ROOT = join(import.meta.dirname, "../../../../templates");
const slugs = readdirSync(ROOT).filter((d) =>
  existsSync(join(ROOT, d, "runbase-template.json")),
);

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

// Example value per field type (dry run test record).
const sample = (f: { key: string; type: string; options?: string[] }) =>
  ({
    text: `Sample ${f.key}`,
    email: "ada@example.com",
    number: 42,
    select: f.options?.[0],
    url: "https://example.com",
    phone: "+33600000000",
    date: "2026-11-23",
  })[f.type];

test("at least 3 templates in the catalog", () => {
  assert.ok(slugs.length >= 3, `${slugs.length} template(s)`);
});

test("test database migration", () => {
  execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
});

for (const slug of slugs)
  test(`template ${slug} : import, validation, dry run`, async () => {
    const raw = JSON.parse(
      readFileSync(join(ROOT, slug, "runbase-template.json"), "utf8"),
    ) as { objects?: unknown[]; secrets?: string[]; records?: unknown[] };
    const ctx = await owner(`Tpl ${slug}`);
    const res = await templatesService.import(ctx, raw);
    assert.equal(res.objects, raw.objects?.length ?? 0);
    assert.equal(res.records, raw.records?.length ?? 0);
    assert.deepEqual(res.missingSecrets, raw.secrets ?? []);
    assert.ok(res.workflows.length > 0, "at least one workflow");

    for (const id of res.workflows) {
      const wf = (await workflowsService.get(ctx, id))!;
      assert.equal(wf.status, "draft");
      const { errors } = await workflowsService.check(ctx, wf.definition);
      assert.deepEqual(
        errors.map((e) => e.message),
        [],
        `${slug} / ${wf.name}`,
      );
      // Test record on the trigger object, then dry run (simulated effects).
      const trigger = wf.definition.trigger as { object?: string };
      const ids: string[] = [];
      if (trigger.object) {
        const obj = (await objectsService.list(ctx)).find(
          (o) => o.id === trigger.object,
        )!;
        const fields = obj.fields as {
          key: string;
          type: string;
          options?: string[];
        }[];
        const data = Object.fromEntries(
          fields
            .map((f) => [f.key, sample(f)] as const)
            .filter(([, v]) => v !== undefined),
        );
        const { record } = await recordsService.upsert(ctx, {
          objectId: obj.id,
          data,
          test: true,
        });
        ids.push(record.id);
      }
      const [run] = await workflowsService.dryRun(ctx, wf.definition, ids);
      assert.equal(run!.error, undefined, `${slug}: ${run!.error}`);
      assert.equal(run!.path.length, wf.definition.steps.length);
      for (const s of run!.path)
        if (s.type.startsWith("node."))
          assert.equal(s.simulated, true, `${s.stepId} simulated`);
    }
  });
