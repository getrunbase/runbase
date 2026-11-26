// Google connector: Gmail (send), Google Calendar (events), Google Sheets
// (rows) and Google Drive (files created by the app). OAuth "google"
// connection; only scopes that need no Google security assessment.
import { z } from "zod";
import { defineNode, type NodeContext, type NodeOAuth } from "@getrunbase/node-sdk";

const SCOPE = "https://www.googleapis.com/auth/";

// Same provider for every node: one connection covers all of them.
const google = (scope: string): NodeOAuth => ({
  provider: "google",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  revokeUrl: "https://oauth2.googleapis.com/revoke",
  scopes: ["openid", "email", `${SCOPE}${scope}`],
  // Refresh token on every consent; keeps scopes granted earlier.
  authorizeParams: {
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  },
});

// JSON call to a Google API; errors carry the status and Google's message.
async function api<T = Record<string, unknown>>(
  ctx: NodeContext,
  method: string,
  url: string,
  body?: unknown,
): Promise<T> {
  const res = await ctx.fetch(url, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      msg = JSON.parse(text).error?.message ?? text;
    } catch {
      // not JSON: raw body
    }
    throw new Error(`Google API failed (${res.status} ${msg.slice(0, 300)})`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

// UTF-8 safe base64 (Deno sandbox: no Buffer).
const b64 = (s: string) => {
  let bin = "";
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
};
const b64url = (s: string) =>
  b64(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
// RFC 2047 header word for non-ASCII values (subject, names).
const header = (v: string) =>
  /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${b64(v)}?=`;
const noCrlf = (v: string) => v.replace(/[\r\n]+/g, " ");

const emails = z.union([z.string().min(3), z.array(z.string().min(3)).min(1)]);
const list = (v?: string | string[]) => (Array.isArray(v) ? v.join(", ") : v);

// RFC 5322 message: text, html, or both (multipart/alternative).
export function mimeMessage(m: {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  subject: string;
  text?: string;
  html?: string;
  inReplyTo?: string;
}) {
  const head = [
    ["To", list(m.to)],
    ["Cc", list(m.cc)],
    ["Bcc", list(m.bcc)],
    ["Reply-To", m.replyTo],
    ["Subject", header(m.subject)],
    ["In-Reply-To", m.inReplyTo],
    ["References", m.inReplyTo],
    ["MIME-Version", "1.0"],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${noCrlf(v!)}`);
  const part = (type: string, body: string) =>
    [
      `Content-Type: ${type}; charset=UTF-8`,
      "Content-Transfer-Encoding: base64",
      "",
      b64(body),
    ].join("\r\n");
  if (m.text !== undefined && m.html !== undefined) {
    const boundary = `rb_${crypto.randomUUID()}`;
    return [
      ...head,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      part("text/plain", m.text),
      `--${boundary}`,
      part("text/html", m.html),
      `--${boundary}--`,
    ].join("\r\n");
  }
  return [
    ...head,
    m.html !== undefined ? part("text/html", m.html) : part("text/plain", m.text ?? ""),
  ].join("\r\n");
}

export const gmailSend = defineNode({
  id: "gmail.send",
  label: "Gmail: send an email",
  description:
    "Sends an email from the connected Gmail account. Give text, html or both. threadId (and the original Message-ID in inReplyTo) sends it as a reply in that thread.",
  auth: { domains: ["gmail.googleapis.com"], oauth: google("gmail.send") },
  inputs: z.object({
      to: emails,
      cc: emails.optional(),
      bcc: emails.optional(),
      replyTo: z.string().optional(),
      subject: z.string(),
      text: z.string().optional(),
      html: z.string().optional(),
      threadId: z.string().optional(),
      inReplyTo: z.string().optional(),
    }),
  outputs: z.object({ id: z.string(), threadId: z.string() }),
  run: async ({ threadId, ...m }, ctx) => {
    if (m.text === undefined && m.html === undefined)
      throw new Error("gmail.send: text or html is required");
    const r = await api<{ id: string; threadId: string }>(
      ctx,
      "POST",
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      { raw: b64url(mimeMessage(m)), ...(threadId && { threadId }) },
    );
    return { id: r.id, threadId: r.threadId };
  },
});

// Google Calendar
const CAL = "https://www.googleapis.com/calendar/v3/calendars";
const calendarId = z
  .string()
  .default("primary")
  .describe("Calendar id; primary = the account's main calendar");
// ISO date-time (2026-12-01T10:00:00+01:00) or all-day date (2026-12-01).
const when = z.string().min(10);
const slot = (v: string, timeZone?: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) ? { date: v } : { dateTime: v, ...(timeZone && { timeZone }) };

const event = z.object({
  id: z.string(),
  summary: z.string().nullable(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  start: z.string().nullable(),
  end: z.string().nullable(),
  status: z.string().nullable(),
  htmlLink: z.string().nullable(),
  meetLink: z.string().nullable(),
  attendees: z.array(z.object({ email: z.string(), responseStatus: z.string().nullable() })),
});
type GEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  status?: string;
  htmlLink?: string;
  hangoutLink?: string;
  attendees?: { email: string; responseStatus?: string }[];
};
const simple = (e: GEvent): z.input<typeof event> => ({
  id: e.id,
  summary: e.summary ?? null,
  description: e.description ?? null,
  location: e.location ?? null,
  start: e.start?.dateTime ?? e.start?.date ?? null,
  end: e.end?.dateTime ?? e.end?.date ?? null,
  status: e.status ?? null,
  htmlLink: e.htmlLink ?? null,
  meetLink: e.hangoutLink ?? null,
  attendees: (e.attendees ?? []).map((a) => ({
    email: a.email,
    responseStatus: a.responseStatus ?? null,
  })),
});

const calAuth = { domains: ["www.googleapis.com"], oauth: google("calendar.events") };
const eventFields = {
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  start: when.optional(),
  end: when.optional(),
  timeZone: z.string().optional().describe("IANA time zone, e.g. Europe/Paris"),
  attendees: z.array(z.string()).optional().describe("Attendee emails"),
  addMeet: z.boolean().optional().describe("Add a Google Meet link"),
  sendUpdates: z.enum(["all", "externalOnly", "none"]).default("none"),
};
type EventInput = { [K in keyof typeof eventFields]?: z.output<(typeof eventFields)[K]> };
const eventBody = (i: EventInput) => ({
  ...(i.summary !== undefined && { summary: i.summary }),
  ...(i.description !== undefined && { description: i.description }),
  ...(i.location !== undefined && { location: i.location }),
  ...(i.start && { start: slot(i.start, i.timeZone) }),
  ...(i.end && { end: slot(i.end, i.timeZone) }),
  ...(i.attendees && { attendees: i.attendees.map((email) => ({ email })) }),
  ...(i.addMeet && {
    conferenceData: {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  }),
});
const eventQuery = (i: EventInput) =>
  new URLSearchParams({
    sendUpdates: i.sendUpdates ?? "none",
    ...(i.addMeet && { conferenceDataVersion: "1" }),
  });
const enc = encodeURIComponent;

export const listEvents = defineNode({
  id: "google_calendar.list_events",
  label: "Google Calendar: list events",
  description:
    "Lists the events of a calendar between two dates (recurring events expanded), sorted by start. q filters by text.",
  auth: calAuth,
  inputs: z.object({
    calendarId,
    timeMin: z.string().optional().describe("ISO date-time, default now"),
    timeMax: z.string().optional().describe("ISO date-time"),
    q: z.string().optional(),
    maxResults: z.number().int().min(1).max(250).default(50),
  }),
  outputs: z.object({ events: z.array(event) }),
  sideEffect: false,
  run: async (i, ctx) => {
    const q = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: String(i.maxResults),
      timeMin: i.timeMin ?? new Date().toISOString(),
      ...(i.timeMax && { timeMax: i.timeMax }),
      ...(i.q && { q: i.q }),
    });
    const r = await api<{ items?: GEvent[] }>(
      ctx,
      "GET",
      `${CAL}/${enc(i.calendarId)}/events?${q}`,
    );
    return { events: (r.items ?? []).map(simple) };
  },
});

export const createEvent = defineNode({
  id: "google_calendar.create_event",
  label: "Google Calendar: create an event",
  description:
    "Creates an event. start and end: ISO date-time, or YYYY-MM-DD for an all-day event. sendUpdates=all emails the attendees.",
  auth: calAuth,
  inputs: z.object({
    calendarId,
    ...eventFields,
    summary: z.string().min(1),
    start: when,
    end: when,
  }),
  outputs: event,
  run: async ({ calendarId, ...i }, ctx) =>
    simple(
      await api<GEvent>(
        ctx,
        "POST",
        `${CAL}/${enc(calendarId)}/events?${eventQuery(i)}`,
        eventBody(i),
      ),
    ),
});

export const updateEvent = defineNode({
  id: "google_calendar.update_event",
  label: "Google Calendar: update an event",
  description:
    "Changes the given fields of an event (others kept). attendees replaces the whole list.",
  auth: calAuth,
  inputs: z.object({ calendarId, eventId: z.string().min(1), ...eventFields }),
  outputs: event,
  run: async ({ calendarId, eventId, ...i }, ctx) =>
    simple(
      await api<GEvent>(
        ctx,
        "PATCH",
        `${CAL}/${enc(calendarId)}/events/${enc(eventId)}?${eventQuery(i)}`,
        eventBody(i),
      ),
    ),
});

export const deleteEvent = defineNode({
  id: "google_calendar.delete_event",
  label: "Google Calendar: delete an event",
  description: "Deletes an event. sendUpdates=all notifies the attendees.",
  auth: calAuth,
  inputs: z.object({
    calendarId,
    eventId: z.string().min(1),
    sendUpdates: eventFields.sendUpdates,
  }),
  outputs: z.object({ deleted: z.boolean() }),
  run: async ({ calendarId, eventId, sendUpdates }, ctx) => {
    await api(
      ctx,
      "DELETE",
      `${CAL}/${enc(calendarId)}/events/${enc(eventId)}?sendUpdates=${sendUpdates}`,
    );
    return { deleted: true };
  },
});

// Google Sheets
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const sheetsAuth = { domains: ["sheets.googleapis.com"], oauth: google("spreadsheets") };
const spreadsheetId = z
  .string()
  .min(1)
  .describe("Id in the sheet URL: docs.google.com/spreadsheets/d/<id>/edit");
const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);
type Cell = z.infer<typeof cell>;
const valuesUrl = (id: string, range: string, suffix = "") =>
  `${SHEETS}/${enc(id)}/values/${enc(range)}${suffix}`;
// "Sheet1!A2:D" -> "Sheet1": the header row is read on the same tab.
const tabOf = (range: string) => range.split("!")[0]!;

async function headerRow(ctx: NodeContext, id: string, range: string) {
  const r = await api<{ values?: Cell[][] }>(
    ctx,
    "GET",
    valuesUrl(id, `${tabOf(range)}!1:1`),
  );
  return (r.values?.[0] ?? []).map(String);
}

export const readRows = defineNode({
  id: "google_sheets.read_rows",
  label: "Google Sheets: read rows",
  description:
    "Reads a range (e.g. Sheet1, or Sheet1!A1:D100). headers=true: the first row gives the keys of each row object.",
  auth: sheetsAuth,
  inputs: z.object({
    spreadsheetId,
    range: z.string().min(1),
    headers: z.boolean().default(true),
  }),
  outputs: z.object({
    rows: z.array(z.union([z.record(z.string(), cell), z.array(cell)])),
  }),
  sideEffect: false,
  run: async ({ spreadsheetId, range, headers }, ctx) => {
    const r = await api<{ values?: Cell[][] }>(
      ctx,
      "GET",
      valuesUrl(spreadsheetId, range),
    );
    const values = r.values ?? [];
    if (!headers) return { rows: values };
    const [head = [], ...rest] = values;
    return {
      rows: rest.map((row) =>
        Object.fromEntries(head.map((h, i) => [String(h), row[i] ?? null])),
      ),
    };
  },
});

export const appendRows = defineNode({
  id: "google_sheets.append_rows",
  label: "Google Sheets: add rows",
  description:
    "Adds rows after the last row of a tab. Rows as objects are matched to the header row (first row) by column name; rows as arrays are written as is.",
  auth: sheetsAuth,
  inputs: z.object({
    spreadsheetId,
    range: z.string().min(1).describe("Tab name, e.g. Sheet1"),
    rows: z
      .array(z.union([z.record(z.string(), cell), z.array(cell)]))
      .min(1),
  }),
  outputs: z.object({ updatedRange: z.string(), updatedRows: z.number() }),
  run: async ({ spreadsheetId, range, rows }, ctx) => {
    const head = rows.some((r) => !Array.isArray(r))
      ? await headerRow(ctx, spreadsheetId, range)
      : [];
    if (rows.some((r) => !Array.isArray(r))) {
      const unknown = [
        ...new Set(
          rows.flatMap((r) => (Array.isArray(r) ? [] : Object.keys(r))),
        ),
      ].filter((k) => !head.includes(k));
      if (unknown.length)
        throw new Error(
          `Columns not in the header row of ${tabOf(range)}: ${unknown.join(", ")}`,
        );
    }
    const values = rows.map((r) =>
      Array.isArray(r) ? r : head.map((h) => r[h] ?? null),
    );
    const r = await api<{
      updates?: { updatedRange?: string; updatedRows?: number };
    }>(
      ctx,
      "POST",
      valuesUrl(
        spreadsheetId,
        range,
        ":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS",
      ),
      { values },
    );
    return {
      updatedRange: r.updates?.updatedRange ?? "",
      updatedRows: r.updates?.updatedRows ?? 0,
    };
  },
});

export const updateRows = defineNode({
  id: "google_sheets.update_rows",
  label: "Google Sheets: update cells",
  description:
    "Overwrites a range (e.g. Sheet1!A2:C3) with the given rows of values, typed as in the sheet (formulas and dates are interpreted).",
  auth: sheetsAuth,
  inputs: z.object({
    spreadsheetId,
    range: z.string().min(1),
    values: z.array(z.array(cell)).min(1),
  }),
  outputs: z.object({ updatedRange: z.string(), updatedCells: z.number() }),
  run: async ({ spreadsheetId, range, values }, ctx) => {
    const r = await api<{ updatedRange?: string; updatedCells?: number }>(
      ctx,
      "PUT",
      valuesUrl(spreadsheetId, range, "?valueInputOption=USER_ENTERED"),
      { values },
    );
    return {
      updatedRange: r.updatedRange ?? "",
      updatedCells: r.updatedCells ?? 0,
    };
  },
});

// Google Drive (drive.file: only files created by Runbase)
export const uploadFile = defineNode({
  id: "google_drive.upload_file",
  label: "Google Drive: create a file",
  description:
    "Creates a file in Google Drive from text (or base64 content). Runbase only sees the files it created.",
  auth: { domains: ["www.googleapis.com"], oauth: google("drive.file") },
  inputs: z.object({
    name: z.string().min(1),
    content: z.string(),
    encoding: z.enum(["text", "base64"]).default("text"),
    mimeType: z.string().default("text/plain"),
    folderId: z.string().optional(),
  }),
  outputs: z.object({ id: z.string(), name: z.string(), webViewLink: z.string().nullable() }),
  run: async ({ name, content, encoding, mimeType, folderId }, ctx) => {
    const boundary = `rb_${crypto.randomUUID()}`;
    const meta = { name, mimeType, ...(folderId && { parents: [folderId] }) };
    const body = [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify(meta),
      `--${boundary}`,
      `Content-Type: ${noCrlf(mimeType)}`,
      "Content-Transfer-Encoding: base64",
      "",
      encoding === "base64" ? content : b64(content),
      `--${boundary}--`,
    ].join("\r\n");
    const res = await ctx.fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
      {
        method: "POST",
        headers: { "content-type": `multipart/related; boundary=${boundary}` },
        body,
      },
    );
    const text = await res.text();
    if (!res.ok)
      throw new Error(`Google API failed (${res.status} ${text.slice(0, 300)})`);
    const f = JSON.parse(text) as { id: string; name: string; webViewLink?: string };
    return { id: f.id, name: f.name, webViewLink: f.webViewLink ?? null };
  },
});

export default [
  gmailSend,
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  readRows,
  appendRows,
  updateRows,
  uploadFile,
];
