// Webhook mapping helpers (unit, no database).
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  changedTo,
  errorText,
  mapPayload,
  mappedValueProblems,
  mappingProblem,
  pickMapped,
  queueEach,
  supersededPayload,
} from "./index";

test("pickMapped: literal path first, then without the deprecated payload. prefix", () => {
  assert.equal(pickMapped({ a: { b: 1 } }, "payload.a.b"), 1);
  assert.equal(pickMapped({ a: { b: 1 } }, "a.b"), 1);
  // A payload that really has a `payload` key keeps the literal path.
  assert.equal(pickMapped({ payload: { a: 2 }, a: 3 }, "payload.a"), 2);
  assert.equal(pickMapped({ a: 1 }, "payload.zz"), undefined);
  assert.deepEqual(
    mapPayload(
      { email: "payload.user.email", n: "x" },
      { user: { email: "a@x.io" } },
    ),
    { email: "a@x.io" },
  );
});

test("mappingProblem: names the path that resolved to nothing", () => {
  assert.equal(
    mappingProblem({ email: "payload.mail" }, "email", {}),
    "path payload.mail resolved to nothing (match field email)",
  );
  assert.equal(
    mappingProblem({ name: "n" }, "email", { name: "A" }),
    "match field email is not mapped",
  );
  assert.equal(
    mappingProblem({ a: "x", b: "y" }, undefined, {}),
    "path x resolved to nothing\npath y resolved to nothing",
  );
  assert.equal(mappingProblem({ a: "x" }, "a", { a: 1 }), null);
});

test("errorText: Zod issues as field: message lines", () => {
  const r = z
    .object({ email: z.string().email(), age: z.number() })
    .safeParse({ email: "no", age: "x" });
  assert.equal(
    errorText(r.error),
    r.error!.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n"),
  );
  assert.match(errorText(r.error), /^email: .+\nage: .+$/);
  assert.equal(errorText(new Error("boom")), "boom");
});

test("supersededPayload: marker under _runbase, payload kept", () => {
  assert.deepEqual(supersededPayload({ n: 1 }, "wf", "e2"), {
    n: 1,
    _runbase: { status: "superseded", supersededBy: "e2", workflowId: "wf" },
  });
});

test("mappedValueProblems: invalid email, unknown option, unknown field", () => {
  const fields = [
    { key: "email", label: "Email", type: "email" as const },
    { key: "plan", label: "Plan", type: "select" as const, options: ["a"] },
  ];
  const p = mappedValueProblems(fields as never, {
    email: "nope",
    plan: "b",
    other: 1,
  });
  assert.deepEqual(
    p.map((x) => x.field),
    ["email", "plan", "other"],
  );
  assert.deepEqual(
    mappedValueProblems(fields as never, { email: "a@x.io", plan: "a" }),
    [],
  );
});

test("queueEach: webhooks keep every delivery by default, others coalesce", () => {
  assert.equal(queueEach({ type: "trigger.webhook", webhook: "h" }), true);
  assert.equal(
    queueEach({ type: "trigger.webhook", webhook: "h", queue: "latest" }),
    false,
  );
  assert.equal(
    queueEach({ type: "trigger.record_updated", object: "deal" }),
    false,
  );
  assert.equal(
    queueEach({ type: "trigger.event", event: "e", queue: "each" }),
    true,
  );
  assert.equal(queueEach({ type: "trigger.manual" }), false);
});

test("changedTo: field must change in this write and equal the value", () => {
  assert.equal(changedTo(undefined, [], {}), true);
  const to = { status: "Qualified" };
  assert.equal(changedTo(to, ["status"], { status: "Qualified" }), true);
  assert.equal(changedTo(to, ["status"], { status: "Lost" }), false);
  // Already Qualified, another field changed: no trigger.
  assert.equal(changedTo(to, ["name"], { status: "Qualified" }), false);
  assert.equal(
    changedTo({ n: 3, ok: true }, ["n", "ok"], { n: 3, ok: true }),
    true,
  );
});
