import { test } from "node:test";
import assert from "node:assert/strict";
import { memoryStorage, type FileStorage } from "../files";
import { renderSweeper } from "./sweeper";

const png = { bytes: new Uint8Array([1]), type: "image/png" };

test("sweep deletes render keys older than the TTL only", async () => {
  const s = memoryStorage();
  let t = 0;
  const sw = renderSweeper(() => s, 1000, () => t);
  await s.put("w/renders/a/desktop-light.png", png);
  sw.track("w/renders/a/desktop-light.png");
  t = 600;
  await s.put("w/renders/b/mobile-light.png", png);
  sw.track("w/renders/b/mobile-light.png");
  t = 1000;
  assert.equal(await sw.sweep(), 1);
  assert.equal(await s.get("w/renders/a/desktop-light.png"), null);
  assert.ok(await s.get("w/renders/b/mobile-light.png"));
  t = 1600;
  assert.equal(await sw.sweep(), 1);
  assert.equal(sw.size(), 0);
});

test("a failed removal is retried on the next sweep", async () => {
  const mem = memoryStorage();
  let fail = true;
  const s: FileStorage = {
    ...mem,
    remove: async (k) => {
      if (fail) throw new Error("down");
      await mem.remove(k);
    },
  };
  let t = 0;
  const sw = renderSweeper(() => s, 10, () => t);
  sw.track("w/renders/c/desktop-light.png");
  t = 20;
  assert.equal(await sw.sweep(), 0);
  assert.equal(sw.size(), 1);
  fail = false;
  assert.equal(await sw.sweep(), 1);
  assert.equal(sw.size(), 0);
});
