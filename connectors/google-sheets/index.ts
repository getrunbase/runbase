// Google Sheets connector. OAuth "google" connection, shared with the other
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

// Google Sheets
const enc = encodeURIComponent;
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const sheetsAuth = {
  domains: ["sheets.googleapis.com"],
  oauth: google("spreadsheets"),
};
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
  label: "Read rows",
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
  label: "Add rows",
  description:
    "Adds rows after the last row of a tab. Rows as objects are matched to the header row (first row) by column name; rows as arrays are written as is.",
  auth: sheetsAuth,
  inputs: z.object({
    spreadsheetId,
    range: z.string().min(1).describe("Tab name, e.g. Sheet1"),
    rows: z.array(z.union([z.record(z.string(), cell), z.array(cell)])).min(1),
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
  label: "Update cells",
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

export default [readRows, appendRows, updateRows];
