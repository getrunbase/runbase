import { test } from "node:test";
import assert from "node:assert/strict";
import { blocks, blockContext, blocksService } from "./index";
import type { TenantContext } from "../tenant";

test("blocks.list exposes blocks with JSON schemas", async () => {
  const list = await blocksService.list();
  const get = list.find((b) => b.type === "record.get")!;
  assert.equal(get.label, "Read a record");
  assert.ok(list.every((b) => b.label && b.description !== undefined));
  assert.deepEqual(get.branches, ["found", "not_found"]);
  assert.equal((get.inputSchema as { type: string }).type, "object");
});

test("a block's ctx goes through tenant-bound services", async () => {
  const bctx = blockContext({} as TenantContext);
  assert.equal("db" in bctx, false);
  // Invalid tenant context: the service refuses, proof that the call forwards it.
  await assert.rejects(blocks["record.get"]!.run({ id: "x" }, bctx));
});

test("catalog: triggers exposed with schemas, deprecated blocks hidden", async () => {
  const list = await blocksService.catalog();
  const types = list.map((b) => b.type);
  for (const t of [
    "trigger.schedule",
    "trigger.record_created",
    "trigger.record_updated",
    "trigger.webhook",
    "trigger.event",
    "trigger.run_failed",
    "trigger.manual",
  ])
    assert.ok(types.includes(t), t);
  const cron = list.find((b) => b.type === "trigger.schedule")!;
  assert.equal(cron.kind, "trigger");
  const props = (cron.inputSchema as { properties: Record<string, unknown> })
    .properties;
  assert.ok(props.cron && props.timezone && props.filter);
  assert.ok(list.every((b) => b.label && b.description));
  assert.equal(types.includes("slack.send"), false);
  // Still in the full list (editor) and executable for existing workflows.
  const full = await blocksService.list();
  assert.equal(
    full.find((b) => b.type === "slack.send")?.deprecated,
    "node.slack.send",
  );
  assert.ok(blocks["slack.send"]);
  assert.equal(list.find((b) => b.type === "record.get")!.kind, "block");
  // The implicit continueOnFail branch is documented on every block.
  const get = list.find((b) => b.type === "record.get") as {
    failBranch?: { branch: string };
  };
  assert.equal(get.failBranch?.branch, "error");
});

test("switch names its fallback branch `else`, loop documents its vars", () => {
  assert.match(blocks["switch"]!.description, /`else`/);
  assert.match(blocks["loop"]!.description, /\{\{item\}\}.*\{\{index\}\}/);
});

test("record.delete describes the trash, like records.delete", () => {
  assert.match(blocks["record.delete"]!.description, /trash/);
});
