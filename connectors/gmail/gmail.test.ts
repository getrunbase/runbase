// gmail connector against a simulated fetch (no network call).
import { test } from "node:test";
import assert from "node:assert/strict";
import { gmailSend, mimeMessage } from "./index";

type Call = { url: string; method: string; body: string };
// Responses served in order; the last one repeats.
function mock(...replies: [number, unknown][]) {
  const calls: Call[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: String(init?.body ?? ""),
    });
    const [status, body] = replies[Math.min(calls.length, replies.length) - 1]!;
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(status === 204 ? null : text, { status });
  };
  return { calls, fetch };
}
const unb64url = (s: string) =>
  Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();

test("every node: google OAuth provider, scopes without security assessment", () => {
  const allowed = new Set([
    "openid",
    "email",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
  ]);
  for (const n of [gmailSend]) {
    const o = n.manifest().auth.oauth!;
    assert.equal(o.provider, "google");
    for (const s of o.scopes) assert.ok(allowed.has(s), `${n.id}: ${s}`);
    assert.equal(o.authorizeParams?.access_type, "offline");
  }
});

test("gmail.send: MIME message, UTF-8 subject, thread", async () => {
  const { calls, fetch } = mock([200, { id: "m1", threadId: "t1" }]);
  const r = await gmailSend.execute(
    {
      to: ["a@x.io", "b@x.io"],
      subject: "Réunion",
      text: "Bonjour",
      threadId: "t1",
      inReplyTo: "<id@x>",
    },
    { fetch },
  );
  assert.deepEqual(r.output, { id: "m1", threadId: "t1" });
  assert.equal(
    calls[0]!.url,
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
  );
  const body = JSON.parse(calls[0]!.body);
  assert.equal(body.threadId, "t1");
  const raw = unb64url(body.raw);
  assert.match(raw, /^To: a@x\.io, b@x\.io\r\n/);
  assert.match(raw, /Subject: =\?UTF-8\?B\?/);
  assert.match(raw, /In-Reply-To: <id@x>/);
  assert.ok(raw.includes(Buffer.from("Bonjour").toString("base64")));
});

test("gmail.send: text + html is multipart; header injection neutralized", () => {
  const raw = mimeMessage({
    to: "a@x.io",
    subject: "Hi\r\nBcc: evil@x.io",
    text: "t",
    html: "<b>h</b>",
  });
  assert.match(raw, /multipart\/alternative/);
  assert.ok(!/\r\nBcc:/.test(raw));
});

test("gmail.send: text or html required", async () => {
  const { fetch } = mock([200, {}]);
  await assert.rejects(
    gmailSend.execute({ to: "a@x.io", subject: "s" }, { fetch }),
    /text or html/,
  );
});
