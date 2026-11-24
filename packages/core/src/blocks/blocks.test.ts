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
