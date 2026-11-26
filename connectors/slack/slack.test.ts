// Slack connector against a simulated fetch (no network call).
import { test } from "node:test";
import assert from "node:assert/strict";
import { send } from "./index";

type Call = { url: string; method: string; body: string };
function mock(status: number, body = "ok") {
  const calls: Call[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: String(init?.body ?? ""),
    });
    return new Response(body, { status });
  };
  return { calls, fetch };
}
const webhookUrl = "https://hooks.slack.com/services/T/B/x";

test("slack.send: posts the text to the webhook", async () => {
  const { calls, fetch } = mock(200);
  const r = await send.execute({ webhookUrl, text: "Hi" }, { fetch });
  assert.deepEqual(r, { branch: "ok", output: { status: 200 } });
  assert.equal(calls[0]!.url, webhookUrl);
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(JSON.parse(calls[0]!.body), { text: "Hi" });
});

test("slack.send: a Slack error is surfaced", async () => {
  const { fetch } = mock(404, "no_service");
  await assert.rejects(
    send.execute({ webhookUrl, text: "y" }, { fetch }),
    /Slack webhook failed \(404 no_service\)/,
  );
});

test("slack.send: refuses a URL outside hooks.slack.com", async () => {
  const { fetch } = mock(200);
  await assert.rejects(
    send.execute({ webhookUrl: "https://evil.test/x", text: "y" }, { fetch }),
    /not a Slack Incoming Webhook URL/,
  );
});

test("slack.send: manifest (secret, domain, required input)", async () => {
  const m = send.manifest();
  assert.deepEqual(m.auth, { secrets: [], domains: ["hooks.slack.com"] });
  await assert.rejects(send.execute({ text: "y" }), /invalid input/);
});
