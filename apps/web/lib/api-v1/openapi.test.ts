// API v1 OpenAPI spec: valid (OpenAPI 3.1), stable (snapshot),
// and each declared endpoint has its handler in app/api/v1.
// Snapshot to regenerate after an intended change: UPDATE_SNAPSHOT=1.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Validator } from "@seriousme/openapi-schema-validator";
import { endpoints } from "./endpoints";
import { openapi } from "./openapi";

const snapshot = fileURLToPath(
  new URL("./openapi.snapshot.json", import.meta.url),
);
const app = fileURLToPath(new URL("../../app/api/v1", import.meta.url));

test("spec OpenAPI 3.1 valide", async () => {
  const res = await new Validator().validate(openapi());
  assert.deepEqual(res.errors ?? [], []);
  assert.equal(res.valid, true);
});

test("spec matches the snapshot", () => {
  const spec = `${JSON.stringify(openapi(), null, 2)}\n`;
  if (process.env.UPDATE_SNAPSHOT || !existsSync(snapshot))
    writeFileSync(snapshot, spec);
  assert.equal(spec, readFileSync(snapshot, "utf8"));
});

test("every schema reference is resolved", () => {
  const spec = openapi() as { components: { schemas: object } };
  const refs = JSON.stringify(spec).match(/#\/components\/schemas\/\w+/g) ?? [];
  for (const r of new Set(refs))
    assert.ok(r.split("/").pop()! in spec.components.schemas, r);
  assert.ok(!JSON.stringify(spec).includes("$defs"));
});

test("every endpoint has its handler", async () => {
  for (const [name, e] of Object.entries(endpoints)) {
    const dir = e.path.replace(/\{(\w+)\}/g, "[$1]");
    // Public catalog endpoints: app/api/catalog.
    const base = "public" in e ? `${app}/../catalog` : app;
    const mod = await import(`${base}${dir}/route.ts`);
    assert.equal(
      typeof mod[e.method],
      "function",
      `${name} ${e.method} ${dir}`,
    );
  }
});
