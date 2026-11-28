import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dateChecks,
  orphanUpsertWarnings,
  parseDate,
  placeholderRecipientChecks,
  regexChecks,
  suggestBlock,
  unknownBlockError,
} from "./validate-hints";
import type { ErrorItem } from "../errors/app-error";
import { evaluateValue } from "../filter";
import { dateBlock } from "../blocks/catalog/data";
import { conditionValueInput } from "../blocks/catalog/condition";

const known = ["record.update", "record.upsert", "event.emit", "condition"];

test("suggestBlock: aliases and typos", () => {
  assert.equal(suggestBlock("records.update", known), "record.update");
  assert.equal(suggestBlock("events.push", known), "event.emit");
  assert.equal(suggestBlock("conditon", known), "condition");
  assert.equal(suggestBlock("totally.unknown.thing", known), undefined);
  const e = unknownBlockError("s1", "events.push", known);
  assert.equal(e.code, "workflows.unknownBlockSuggest");
  assert.match(e.message, /did you mean event\.emit/);
  assert.equal(unknownBlockError("s1", "zzz", known).code, "workflows.unknownBlock");
});

test("regexChecks: invalid pattern reported with the step id", () => {
  const errors: ErrorItem[] = [];
  regexChecks(
    [
      { id: "bad", type: "condition", input: { left: "x", op: "regex", right: "(" } },
      { id: "ok", type: "condition", input: { left: "x", op: "regex", right: "^a", flags: "i" } },
      { id: "tpl", type: "condition", input: { left: "x", op: "regex", right: "{{event.p}}" } },
      { id: "sw", type: "switch", input: { value: "x", cases: [{ op: "regex", value: "[" }] } },
    ],
    errors,
  );
  assert.deepEqual(errors.map((e) => e.params?.step), ["bad", "sw"]);
  assert.equal(errors[0]!.code, "workflows.invalidRegex");
});

test("regex flags: case-insensitive match", () => {
  assert.equal(evaluateValue("regex", "HELLO", "^hello"), false);
  assert.equal(evaluateValue("regex", "HELLO", "^hello", new Date(), "i"), true);
  assert.ok(conditionValueInput.safeParse({ left: 1, op: "regex", right: "a", caseInsensitive: true }).success);
  assert.ok(!conditionValueInput.safeParse({ left: 1, op: "regex", right: "a", flags: "g" }).success);
});

test("dates: now/today accepted, literal invalid dates flagged", async () => {
  const now = new Date("2026-03-04T10:11:12Z");
  assert.equal(parseDate("now", now)?.toISOString(), now.toISOString());
  assert.equal(parseDate("today", now)?.toISOString(), "2026-03-04T00:00:00.000Z");
  assert.equal(parseDate("nope"), undefined);
  const r = await dateBlock.run({ op: "diff", date: "today", to: "now", unit: "days" } as never, {} as never);
  assert.equal(r.branch, "ok");
  const errors: ErrorItem[] = [];
  dateChecks(
    [
      { id: "d1", type: "date", input: { op: "add", date: "tomorrow-ish", amount: 1, unit: "days" } },
      { id: "d2", type: "date", input: { op: "diff", date: "now", to: "{{event.at}}", unit: "days" } },
    ],
    errors,
  );
  assert.deepEqual(errors.map((e) => [e.code, e.params?.step]), [["workflows.invalidDate", "d1"]]);
});

test("placeholder recipients warned on send blocks only", () => {
  const w: ErrorItem[] = [];
  placeholderRecipientChecks(
    [
      { id: "g", type: "node.gmail.send", input: { to: "jane@example.com", body: "x" } },
      { id: "l", type: "node.slack.send", input: { channel: "#sales", text: "see example.org" } },
      { id: "h", type: "http.request", input: { to: "a@example.com" } },
      { id: "m", type: "email", input: { to: ["ok@acme.io", "b@example.org"] } },
    ],
    w,
  );
  assert.deepEqual(w.map((x) => x.params?.step), ["g", "m"]);
  assert.equal(w[0]!.code, "workflows.placeholderRecipient");
});

test("orphan webhook record warning", () => {
  const steps = [{ id: "fail", type: "stop.error", input: { message: "bad" } }];
  const w: ErrorItem[] = [];
  orphanUpsertWarnings({ type: "trigger.webhook", object: "lead", mapping: { email: "email" } }, steps, w);
  assert.equal(w[0]?.code, "workflows.orphanWebhookRecord");
  const none: ErrorItem[] = [];
  orphanUpsertWarnings({ type: "trigger.webhook" }, steps, none);
  orphanUpsertWarnings({ type: "trigger.manual", object: "lead", mapping: {} }, steps, none);
  assert.equal(none.length, 0);
});
