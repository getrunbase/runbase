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
import { getBlock } from "../blocks";
import { webhooksService } from "../webhooks";
import { secretsService } from "../secrets";

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

// Value matching a JSON schema (simulated AI output).
type Schema = {
  type?: string;
  enum?: unknown[];
  minimum?: number;
  properties?: Record<string, Schema>;
};
const fromSchema = (s: Schema): unknown =>
  s.enum?.[0] ??
  {
    string: "Sample",
    number: s.minimum ?? 1,
    integer: s.minimum ?? 1,
    boolean: true,
    array: [],
    object: Object.fromEntries(
      Object.entries(s.properties ?? {}).map(([k, v]) => [k, fromSchema(v)]),
    ),
  }[s.type ?? "object"];

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

    // Webhooks are created by the user after import (README): create the
    // ones the triggers name so the check can resolve them.
    for (const id of res.workflows) {
      const t = (await workflowsService.get(ctx, id))!.definition.trigger as {
        type: string;
        webhook?: string;
      };
      if (t.type === "trigger.webhook" && t.webhook)
        await webhooksService
          .create(ctx, {
            name: t.webhook,
            eventType: t.webhook,
            secretName: `${t.webhook.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_SECRET`,
            config: { format: "standard" },
          })
          .catch((e: { code?: string }) => {
            if (e.code !== "conflict") throw e; // shared by two workflows
          });
    }

    // Secrets the template declares are set by the user after import.
    for (const name of raw.secrets ?? [])
      await secretsService.set(ctx, name, "test");

    for (const id of res.workflows) {
      const wf = (await workflowsService.get(ctx, id))!;
      assert.equal(wf.status, "draft");
      const { errors } = await workflowsService.check(ctx, wf.definition);
      assert.deepEqual(
        // OAuth connections and the AI provider are set by the user after
        // import (README).
        errors
          .filter(
            (e) =>
              e.code !== "workflows.missingConnection" &&
              e.code !== "workflows.missingAiConfig",
          )
          .map((e) => e.message),
        [],
        `${slug} / ${wf.name}`,
      );
      // Test record on the trigger object, then dry run (simulated effects).
      const trigger = wf.definition.trigger as { object?: string };
      const ids: string[] = [];
      // A sample record of the template when it has one (realistic data),
      // otherwise a record built from the field types.
      const [own] = trigger.object
        ? await sql`select id from records where object_id = ${trigger.object} order by created_at limit 1`
        : [];
      if (own) ids.push(own.id as string);
      else if (trigger.object) {
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
      // Connector reads (no side effect) run for real in a dry run and
      // need an OAuth account: pin an empty output instead, as a builder
      // would before connecting one.
      const pins: Record<string, { output: unknown }> = {};
      const steps = wf.definition.steps as {
        id: string;
        type: string;
        input?: unknown;
      }[];
      for (const s of steps) {
        // AI is simulated (null output): pin a structured result instead
        // so the steps reading `result.<key>` get a value.
        const schema = (s.input as { schema?: Schema } | undefined)?.schema;
        if (s.type === "ai.run" && schema)
          pins[s.id] = { output: { result: fromSchema(schema) } };
        if (s.type.startsWith("node.")) {
          const block = await getBlock(ctx, s.type);
          if (block && !block.sideEffect)
            pins[s.id] = {
              output: {
                rows: [],
                items: [],
                values: [],
                files: [],
                events: [],
                messages: [],
              },
            };
        }
      }
      const definition = {
        ...wf.definition,
        pins: { ...wf.definition.pins, ...pins },
      };
      const [run] = await workflowsService.dryRun(ctx, definition, ids);
      assert.equal(run!.error, undefined, `${slug}: ${run!.error}`);
      // Branches not taken and steps after a human approval are not in the path.
      assert.ok(run!.path.length > 0);
      assert.ok(run!.path.length <= wf.definition.steps.length);
      for (const s of run!.path)
        if (s.type.startsWith("node.") && !pins[s.stepId])
          assert.equal(s.simulated, true, `${s.stepId} simulated`);
    }
  });
