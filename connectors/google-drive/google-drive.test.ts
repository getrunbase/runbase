// google-drive connector against a simulated fetch (no network call).
import { test } from "node:test";
import assert from "node:assert/strict";
import { uploadFile } from "./index";

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

test("every node: google OAuth provider, scopes without security assessment", () => {
  const allowed = new Set([
    "openid",
    "email",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
  ]);
  for (const n of [uploadFile]) {
    const o = n.manifest().auth.oauth!;
    assert.equal(o.provider, "google");
    for (const s of o.scopes) assert.ok(allowed.has(s), `${n.id}: ${s}`);
    assert.equal(o.authorizeParams?.access_type, "offline");
  }
});

test("drive.upload_file: multipart upload; Google errors surfaced", async () => {
  const { calls, fetch } = mock(
    [200, { id: "f1", name: "a.txt", webViewLink: "https://drive" }],
    [403, { error: { message: "Insufficient Permission" } }],
  );
  const r = await uploadFile.execute(
    { name: "a.txt", content: "héllo" },
    { fetch },
  );
  assert.deepEqual(r.output, {
    id: "f1",
    name: "a.txt",
    webViewLink: "https://drive",
  });
  assert.match(calls[0]!.url, /uploadType=multipart/);
  assert.ok(calls[0]!.body.includes(Buffer.from("héllo").toString("base64")));
  await assert.rejects(
    uploadFile.execute({ name: "b.txt", content: "x" }, { fetch }),
    /Google API failed \(403 Insufficient Permission\)/,
  );
});
