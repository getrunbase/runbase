import { after, test } from "node:test";
import assert from "node:assert/strict";
import type { ShotClaims } from "@/lib/screenshot-token";
import { liveTarget } from "./target";

// tenant.ts opens DB/Redis handles on import.
after(() => setImmediate(() => process.exit(0)));

const shot = { page: "p1", ws: "w1", user: "u1" } as unknown as ShotClaims;

test("live: app session follows any requested page", () => {
  assert.equal(liveTarget(null, "p2"), "p2");
});

test("live: capture token follows only its own page", () => {
  assert.equal(liveTarget(shot, "p1"), "p1");
  assert.equal(liveTarget(shot, "p2"), null);
  assert.equal(liveTarget(shot, ""), null);
});
