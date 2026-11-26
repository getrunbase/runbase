// google-sheets connector against a simulated fetch (no network call).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readRows, appendRows, updateRows } from "./index";

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
  for (const n of [readRows, appendRows, updateRows]) {
    const o = n.manifest().auth.oauth!;
    assert.equal(o.provider, "google");
    for (const s of o.scopes) assert.ok(allowed.has(s), `${n.id}: ${s}`);
    assert.equal(o.authorizeParams?.access_type, "offline");
  }
});

test("sheets: read with headers, append objects by column name, update", async () => {
  const { calls, fetch } = mock(
    [200, { values: [["email", "name"], ["a@x.io", "Ada"], ["b@x.io"]] }],
    [200, { values: [["email", "name"]] }],
    [200, { updates: { updatedRange: "Leads!A3:B3", updatedRows: 1 } }],
    [200, { updatedRange: "Leads!A2:B2", updatedCells: 2 }],
  );
  const r = await readRows.execute(
    { spreadsheetId: "s1", range: "Leads" },
    { fetch },
  );
  assert.deepEqual(r.output.rows, [
    { email: "a@x.io", name: "Ada" },
    { email: "b@x.io", name: null },
  ]);

  const a = await appendRows.execute(
    {
      spreadsheetId: "s1",
      range: "Leads",
      rows: [{ name: "Bob", email: "c@x.io" }],
    },
    { fetch },
  );
  assert.equal(a.output.updatedRows, 1);
  assert.match(calls[1]!.url, /values\/Leads!1%3A1$/);
  assert.match(calls[2]!.url, /:append\?valueInputOption=USER_ENTERED/);
  assert.deepEqual(JSON.parse(calls[2]!.body), { values: [["c@x.io", "Bob"]] });

  await updateRows.execute(
    { spreadsheetId: "s1", range: "Leads!A2:B2", values: [["x", 1]] },
    { fetch },
  );
  assert.equal(calls[3]!.method, "PUT");
});

test("sheets.append_rows: unknown column refused", async () => {
  const { fetch } = mock([200, { values: [["email"]] }]);
  await assert.rejects(
    appendRows.execute(
      { spreadsheetId: "s1", range: "Leads", rows: [{ phone: "1" }] },
      { fetch },
    ),
    /Columns not in the header row of Leads: phone/,
  );
});

test("sheets: choices for the step form (file name, tabs, header columns)", async () => {
  const { calls, fetch } = mock(
    [200, { properties: { title: "Leads 2026" } }],
    [
      200,
      {
        sheets: [
          { properties: { title: "Leads" } },
          { properties: { title: "Old" } },
        ],
      },
    ],
    [200, { values: [["email", "name", ""]] }],
  );
  assert.deepEqual(readRows.manifest().options, ["spreadsheetId", "range"]);
  assert.deepEqual(appendRows.manifest().options, [
    "spreadsheetId",
    "range",
    "rows",
  ]);
  assert.deepEqual(
    await readRows.loadOptions(
      "spreadsheetId",
      { spreadsheetId: "s1" },
      { fetch },
    ),
    [{ value: "s1", label: "Leads 2026" }],
  );
  assert.match(calls[0]!.url, /spreadsheets\/s1\?fields=properties.title$/);
  assert.deepEqual(
    await updateRows.loadOptions("range", { spreadsheetId: "s1" }, { fetch }),
    [
      { value: "Leads", label: "Leads" },
      { value: "Old", label: "Old" },
    ],
  );
  assert.match(calls[1]!.url, /\?fields=sheets.properties.title$/);
  assert.deepEqual(
    await appendRows.loadOptions(
      "rows",
      { spreadsheetId: "s1", range: "Leads" },
      { fetch },
    ),
    [
      { value: "email", label: "email" },
      { value: "name", label: "name" },
    ],
  );
  // Nothing picked yet, or a variable: no call.
  assert.deepEqual(await appendRows.loadOptions("range", {}, { fetch }), []);
  assert.deepEqual(
    await appendRows.loadOptions(
      "rows",
      { spreadsheetId: "{{x}}", range: "A" },
      { fetch },
    ),
    [],
  );
  assert.equal(calls.length, 3);
});
