// External connectors: loading from a folder and from an
// npm package, static registry, execution in the Deno sandbox and in a
// workflow. Requires `deno`; the workflow test, DATABASE_URL and REDIS_URL.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { Worker } from "bullmq";
import { init } from "@runbase/node-sdk/cli";
import { blocksService, getBlock, blockContext } from "./index";
import type { TenantContext } from "../tenant";

const FIXTURES = fileURLToPath(
  new URL("./fixtures/connectors", import.meta.url),
);
const tmp: string[] = [];
const prevDirs = process.env.RUNBASE_CONNECTORS_DIRS;
after(async () => {
  process.env.RUNBASE_CONNECTORS_DIRS = prevDirs;
  await Promise.all(tmp.map((d) => rm(d, { recursive: true, force: true })));
  setImmediate(() => process.exit(0));
});

// "npm" root: node_modules/@runbase-connectors/<name>, CLI skeleton.
async function npmRoot(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "conn-npm-"));
  tmp.push(d);
  const root = join(d, "node_modules", "@runbase-connectors");
  await mkdir(root, { recursive: true });
  await init("hello", root);
  return root;
}

const ctx0 = {} as TenantContext;

test("connectors: folder and npm package loaded into the catalog without changing the core", async () => {
  process.env.RUNBASE_CONNECTORS_DIRS = [FIXTURES, await npmRoot()].join(
    delimiter,
  );
  const list = await blocksService.list();
  const echo = list.find((b) => b.type === "node.echo.shout");
  assert.ok(echo, "node.echo.shout missing from the catalog");
  assert.equal(echo.label, "Shout");
  assert.deepEqual(echo.branches, ["short", "long"]);
  assert.equal((echo.inputSchema as { type: string }).type, "object");
  assert.ok(list.some((b) => b.type === "node.hello.hello"));
  // Static blocks still there.
  assert.ok(list.some((b) => b.type === "record.get"));

  const hello = await getBlock(ctx0, "node.hello.hello");
  const r = await hello!.run(
    hello!.inputSchema.parse({ name: "Ada" }),
    blockContext(ctx0),
  );
  assert.deepEqual(r, { branch: "ok", output: { message: "Hello Ada" } });
  assert.equal(await getBlock(ctx0, "node.nope.none"), undefined);
});

test("execution in the Deno sandbox: routed branch, validated input", async () => {
  process.env.RUNBASE_CONNECTORS_DIRS = FIXTURES;
  const b = (await getBlock(ctx0, "node.echo.shout"))!;
  assert.equal(b.sideEffect, false);
  // No tenant: no secret read (empty prefix).
  const bare = { ...blockContext(ctx0), tenant: undefined };
  const r = await b.run(b.inputSchema.parse({ text: "bonjour" }), bare);
  assert.deepEqual(r, {
    branch: "long",
    output: { text: "BONJOUR", sandboxed: true },
  });
  assert.equal(b.inputSchema.safeParse({ text: "" }).success, false);
  // Validation on the connector side too (sandbox).
  await assert.rejects(b.run({ text: 3 }, bare), /invalid input/);
});

test("static registry: catalog read without running the connector", async () => {
  const root = await mkdtemp(join(tmpdir(), "conn-reg-"));
  tmp.push(root);
  await cp(join(FIXTURES, "echo"), join(root, "echo"), { recursive: true });
  const manifest = {
    id: "echo.shout",
    label: "From registry",
    description: "",
    branches: ["short", "long"],
    sideEffect: false,
    auth: { secrets: [], domains: [] },
    inputSchema: { type: "object", properties: {} },
    outputSchema: {},
  };
  await writeFile(
    join(root, "registry.json"),
    JSON.stringify({
      connectors: [
        {
          name: "@runbase-connectors/echo",
          version: "1.0.0",
          label: "Echo",
          description: "",
          path: "echo",
          nodes: [manifest],
        },
      ],
    }),
  );
  process.env.RUNBASE_CONNECTORS_DIRS = root;
  const list = await blocksService.list();
  assert.equal(
    list.find((b) => b.type === "node.echo.shout")?.label,
    "From registry",
  );
});

test("broken connector ignored, the others stay loaded", async () => {
  const root = await mkdtemp(join(tmpdir(), "conn-bad-"));
  tmp.push(root);
  await cp(join(FIXTURES, "echo"), join(root, "echo"), { recursive: true });
  await mkdir(join(root, "broken"));
  await writeFile(
    join(root, "broken/package.json"),
    JSON.stringify({ name: "@runbase-connectors/broken", runbase: {} }),
  );
  await writeFile(
    join(root, "broken/index.ts"),
    `import "node:fs"; export default 1;`,
  );
  process.env.RUNBASE_CONNECTORS_DIRS = root;
  const types = (await blocksService.list()).map((b) => b.type);
  assert.ok(types.includes("node.echo.shout"));
  assert.ok(!types.some((t) => t.startsWith("node.broken")));
});

test("workflow: connector node run with the workspace secrets", async (t) => {
  if (!process.env.DATABASE_URL || !process.env.REDIS_URL)
    return t.skip("DATABASE_URL / REDIS_URL required");
  process.env.RUNBASE_CONNECTORS_DIRS = FIXTURES;
  const { queueOptions } = await import("../bus");
  const { workflowsService } = await import("../workflows");
  const { secretsService } = await import("../secrets");
  const { processStep, runsService, RUNS_QUEUE } = await import("../runs");
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  const [org] =
    await sql`insert into organizations (name) values ('Connectors') returning id`;
  const [ws] =
    await sql`insert into workspaces (organization_id, name) values (${org!.id}, 'Default') returning id`;
  const uid = crypto.randomUUID();
  await sql`insert into "user" (id, name, email) values (${uid}, 'c', ${uid + "@x.io"})`;
  await sql`insert into memberships (user_id, organization_id, role) values (${uid}, ${org!.id}, 'owner')`;
  await sql.end();
  const ctx: TenantContext = {
    organizationId: org!.id,
    workspaceId: ws!.id,
    actor: { userId: uid },
  };
  const worker = new Worker(RUNS_QUEUE, processStep, queueOptions());
  try {
    await secretsService.set(ctx, "ECHO_PREFIX", ">> ");
    const definition = {
      trigger: { type: "trigger.manual" },
      steps: [
        {
          id: "shout",
          type: "node.echo.shout",
          input: { text: "{{event.word}}" },
        },
        {
          id: "after",
          type: "data.set",
          input: { values: { got: "{{steps.shout.output.text}}" } },
        },
      ],
      next: { shout: { short: ["after"], long: ["after"] } },
    };
    const wf = await workflowsService.create(ctx, { name: "cri", definition });
    const run0 = await runsService.start(ctx, wf.id, {
      event: { word: "hey" },
    });
    let run;
    for (let i = 0; i < 200; i++) {
      run = await runsService.get(ctx, run0!.id);
      if (!["running", "waiting"].includes(run!.status)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(run!.status, "succeeded", JSON.stringify(run!.steps));
    const shout = run!.steps.find((s) => s.stepId === "shout")!;
    assert.equal(shout.branch, "short");
    // Secret value masked in the stored run outputs.
    assert.deepEqual(shout.output, { text: "***HEY", sandboxed: true });
    assert.deepEqual(run!.steps.find((s) => s.stepId === "after")!.output, {
      got: "***HEY",
    });
  } finally {
    await worker.close();
  }
});
