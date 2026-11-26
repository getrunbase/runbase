// Google connector against a simulated fetch (no network call).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendRows,
  createEvent,
  deleteEvent,
  gmailSend,
  listEvents,
  mimeMessage,
  readRows,
  updateEvent,
  updateRows,
  uploadFile,
} from "./index";

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
  for (const n of [gmailSend, listEvents, createEvent, updateEvent, deleteEvent, readRows, appendRows, updateRows, uploadFile]) {
    const o = n.manifest().auth.oauth!;
    assert.equal(o.provider, "google");
    for (const s of o.scopes) assert.ok(allowed.has(s), `${n.id}: ${s}`);
    assert.equal(o.authorizeParams?.access_type, "offline");
  }
});

test("gmail.send: MIME message, UTF-8 subject, thread", async () => {
  const { calls, fetch } = mock([200, { id: "m1", threadId: "t1" }]);
  const r = await gmailSend.execute(
    { to: ["a@x.io", "b@x.io"], subject: "Réunion", text: "Bonjour", threadId: "t1", inReplyTo: "<id@x>" },
    { fetch },
  );
  assert.deepEqual(r.output, { id: "m1", threadId: "t1" });
  assert.equal(calls[0]!.url, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
  const body = JSON.parse(calls[0]!.body);
  assert.equal(body.threadId, "t1");
  const raw = unb64url(body.raw);
  assert.match(raw, /^To: a@x\.io, b@x\.io\r\n/);
  assert.match(raw, /Subject: =\?UTF-8\?B\?/);
  assert.match(raw, /In-Reply-To: <id@x>/);
  assert.ok(raw.includes(Buffer.from("Bonjour").toString("base64")));
});

test("gmail.send: text + html is multipart; header injection neutralized", () => {
  const raw = mimeMessage({ to: "a@x.io", subject: "Hi\r\nBcc: evil@x.io", text: "t", html: "<b>h</b>" });
  assert.match(raw, /multipart\/alternative/);
  assert.ok(!/\r\nBcc:/.test(raw));
});

test("gmail.send: text or html required", async () => {
  const { fetch } = mock([200, {}]);
  await assert.rejects(gmailSend.execute({ to: "a@x.io", subject: "s" }, { fetch }), /text or html/);
});

test("calendar: list, create with Meet, update, delete", async () => {
  const ev = { id: "e1", summary: "Demo", start: { dateTime: "2026-12-01T10:00:00Z" }, end: { date: "2026-12-02" }, hangoutLink: "https://meet" };
  const { calls, fetch } = mock([200, { items: [ev] }], [200, ev], [200, ev], [204, ""]);
  const l = await listEvents.execute({ timeMin: "2026-12-01T00:00:00Z" }, { fetch });
  assert.equal(l.output.events[0]!.start, "2026-12-01T10:00:00Z");
  assert.equal(l.output.events[0]!.end, "2026-12-02");
  assert.match(calls[0]!.url, /calendars\/primary\/events\?singleEvents=true&orderBy=startTime/);

  const c = await createEvent.execute(
    { summary: "Demo", start: "2026-12-01", end: "2026-12-02", attendees: ["a@x.io"], addMeet: true },
    { fetch },
  );
  assert.equal(c.output.meetLink, "https://meet");
  assert.match(calls[1]!.url, /conferenceDataVersion=1/);
  const body = JSON.parse(calls[1]!.body);
  assert.deepEqual(body.start, { date: "2026-12-01" });
  assert.deepEqual(body.attendees, [{ email: "a@x.io" }]);
  assert.ok(body.conferenceData.createRequest.requestId);

  await updateEvent.execute({ eventId: "e1", summary: "New" }, { fetch });
  assert.equal(calls[2]!.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[2]!.body), { summary: "New" });

  const d = await deleteEvent.execute({ eventId: "e1" }, { fetch });
  assert.deepEqual(d.output, { deleted: true });
  assert.equal(calls[3]!.method, "DELETE");
});

test("sheets: read with headers, append objects by column name, update", async () => {
  const { calls, fetch } = mock(
    [200, { values: [["email", "name"], ["a@x.io", "Ada"], ["b@x.io"]] }],
    [200, { values: [["email", "name"]] }],
    [200, { updates: { updatedRange: "Leads!A3:B3", updatedRows: 1 } }],
    [200, { updatedRange: "Leads!A2:B2", updatedCells: 2 }],
  );
  const r = await readRows.execute({ spreadsheetId: "s1", range: "Leads" }, { fetch });
  assert.deepEqual(r.output.rows, [{ email: "a@x.io", name: "Ada" }, { email: "b@x.io", name: null }]);

  const a = await appendRows.execute(
    { spreadsheetId: "s1", range: "Leads", rows: [{ name: "Bob", email: "c@x.io" }] },
    { fetch },
  );
  assert.equal(a.output.updatedRows, 1);
  assert.match(calls[1]!.url, /values\/Leads!1%3A1$/);
  assert.match(calls[2]!.url, /:append\?valueInputOption=USER_ENTERED/);
  assert.deepEqual(JSON.parse(calls[2]!.body), { values: [["c@x.io", "Bob"]] });

  await updateRows.execute({ spreadsheetId: "s1", range: "Leads!A2:B2", values: [["x", 1]] }, { fetch });
  assert.equal(calls[3]!.method, "PUT");
});

test("sheets.append_rows: unknown column refused", async () => {
  const { fetch } = mock([200, { values: [["email"]] }]);
  await assert.rejects(
    appendRows.execute({ spreadsheetId: "s1", range: "Leads", rows: [{ phone: "1" }] }, { fetch }),
    /Columns not in the header row of Leads: phone/,
  );
});

test("drive.upload_file: multipart upload; Google errors surfaced", async () => {
  const { calls, fetch } = mock([200, { id: "f1", name: "a.txt", webViewLink: "https://drive" }], [403, { error: { message: "Insufficient Permission" } }]);
  const r = await uploadFile.execute({ name: "a.txt", content: "héllo" }, { fetch });
  assert.deepEqual(r.output, { id: "f1", name: "a.txt", webViewLink: "https://drive" });
  assert.match(calls[0]!.url, /uploadType=multipart/);
  assert.ok(calls[0]!.body.includes(Buffer.from("héllo").toString("base64")));
  await assert.rejects(
    listEvents.execute({}, { fetch }),
    /Google API failed \(403 Insufficient Permission\)/,
  );
});
