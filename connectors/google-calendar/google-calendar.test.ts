// google-calendar connector against a simulated fetch (no network call).
import { test } from "node:test";
import assert from "node:assert/strict";
import { listEvents, createEvent, updateEvent, deleteEvent } from "./index";

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
  for (const n of [listEvents, createEvent, updateEvent, deleteEvent]) {
    const o = n.manifest().auth.oauth!;
    assert.equal(o.provider, "google");
    for (const s of o.scopes) assert.ok(allowed.has(s), `${n.id}: ${s}`);
    assert.equal(o.authorizeParams?.access_type, "offline");
  }
});

test("calendar: list, create with Meet, update, delete", async () => {
  const ev = {
    id: "e1",
    summary: "Demo",
    start: { dateTime: "2026-12-01T10:00:00Z" },
    end: { date: "2026-12-02" },
    hangoutLink: "https://meet",
  };
  const { calls, fetch } = mock(
    [200, { items: [ev] }],
    [200, ev],
    [200, ev],
    [204, ""],
  );
  const l = await listEvents.execute(
    { timeMin: "2026-12-01T00:00:00Z" },
    { fetch },
  );
  assert.equal(l.output.events[0]!.start, "2026-12-01T10:00:00Z");
  assert.equal(l.output.events[0]!.end, "2026-12-02");
  assert.match(
    calls[0]!.url,
    /calendars\/primary\/events\?singleEvents=true&orderBy=startTime/,
  );

  const c = await createEvent.execute(
    {
      summary: "Demo",
      start: "2026-12-01",
      end: "2026-12-02",
      attendees: ["a@x.io"],
      addMeet: true,
    },
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

test("calendar: calendarId choices from the account's calendar list", async () => {
  const { calls, fetch } = mock([
    200,
    {
      items: [
        { id: "ada@x.io", summary: "Ada", primary: true },
        { id: "team@group.calendar.google.com", summary: "Team" },
      ],
    },
  ]);
  for (const n of [listEvents, createEvent, updateEvent, deleteEvent])
    assert.deepEqual(n.manifest().options, ["calendarId"]);
  assert.deepEqual(await listEvents.loadOptions("calendarId", {}, { fetch }), [
    { value: "primary", label: "Ada" },
    { value: "team@group.calendar.google.com", label: "Team" },
  ]);
  assert.match(
    calls[0]!.url,
    /\/users\/me\/calendarList\?minAccessRole=reader$/,
  );
});
