// Slack connector against a simulated fetch (no network call).
import { test } from "node:test";
import assert from "node:assert/strict";
import { postMessage } from "./index";

type Call = { url: string; method: string; headers: Headers; body: string };
function mock(...responses: [number, unknown][]) {
  const calls: Call[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: String(init?.body ?? ""),
    });
    const [status, body] = responses.shift() ?? [500, {}];
    return new Response(JSON.stringify(body), { status });
  };
  return { calls, fetch };
}
const secrets = { SLACK_BOT_TOKEN: "xoxb-test" };

test("slack.post_message: calls chat.postMessage with the token", async () => {
  const { calls, fetch } = mock([
    200,
    { ok: true, channel: "C1", ts: "1700.1" },
  ]);
  const r = await postMessage.execute(
    { channel: "#sales", text: "Hi", threadTs: "1699.0" },
    { secrets, fetch },
  );
  assert.deepEqual(r, {
    branch: "ok",
    output: { channel: "C1", ts: "1700.1" },
  });
  assert.equal(calls[0]!.url, "https://slack.com/api/chat.postMessage");
  assert.equal(calls[0]!.method, "POST");
  assert.equal(calls[0]!.headers.get("authorization"), "Bearer xoxb-test");
  assert.deepEqual(JSON.parse(calls[0]!.body), {
    channel: "#sales",
    text: "Hi",
    thread_ts: "1699.0",
  });
});

test("slack.post_message: ok: false surfaces the Slack error", async () => {
  const { fetch } = mock([200, { ok: false, error: "channel_not_found" }]);
  await assert.rejects(
    postMessage.execute({ channel: "x", text: "y" }, { secrets, fetch }),
    /Slack chat.postMessage failed \(channel_not_found\)/,
  );
});

test("slack.post_message: manifest (secret, domain, required input)", async () => {
  const m = postMessage.manifest();
  assert.deepEqual(m.auth, {
    secrets: ["SLACK_BOT_TOKEN"],
    domains: ["slack.com"],
  });
  await assert.rejects(postMessage.execute({ channel: "x" }), /invalid input/);
});
