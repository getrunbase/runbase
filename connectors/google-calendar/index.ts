// Google Calendar connector. OAuth "google" connection, shared with the other
// Google connectors: one account covers Gmail, Calendar, Sheets and Drive.
// Only scopes that need no Google security assessment.
import { z } from "zod";
import {
  defineNode,
  type NodeContext,
  type NodeOAuth,
} from "@getrunbase/node-sdk";

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

// Google Calendar
const CAL = "https://www.googleapis.com/calendar/v3/calendars";
const calendarId = z
  .string()
  .default("primary")
  .describe("Calendar id; primary = the account's main calendar");
// ISO date-time (2026-12-01T10:00:00+01:00) or all-day date (2026-12-01).
const when = z.string().min(10);
const slot = (v: string, timeZone?: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v)
    ? { date: v }
    : { dateTime: v, ...(timeZone && { timeZone }) };

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
  attendees: z.array(
    z.object({ email: z.string(), responseStatus: z.string().nullable() }),
  ),
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

const calAuth = {
  domains: ["www.googleapis.com"],
  oauth: google("calendar.events"),
};
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
type EventInput = {
  [K in keyof typeof eventFields]?: z.output<(typeof eventFields)[K]>;
};
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
  label: "List events",
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
  label: "Create an event",
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
  label: "Update an event",
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
  label: "Delete an event",
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

export default [listEvents, createEvent, updateEvent, deleteEvent];
