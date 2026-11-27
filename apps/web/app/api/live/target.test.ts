import { after, test } from "node:test";
import assert from "node:assert/strict";
import type { ShotClaims } from "@/lib/screenshot-token";
import { liveAccess } from "./target";

// tenant.ts opens DB/Redis handles on import.
after(() => setImmediate(() => process.exit(0)));

const shot = { page: "p1", ws: "w1", user: "u1" } as unknown as ShotClaims;

test("live: app session streams any requested page", () => {
  assert.equal(liveAccess(null, "p2"), "stream");
});

test("live: capture of its own page gets 204, no stream", () => {
  assert.equal(liveAccess(shot, "p1"), "skip");
});

test("live: capture token is forbidden on any other page", () => {
  assert.equal(liveAccess(shot, "p2"), "forbidden");
  assert.equal(liveAccess(shot, ""), "forbidden");
});
