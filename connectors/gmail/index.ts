// Gmail connector. OAuth "google" connection, shared with the other
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
    m.html !== undefined
      ? part("text/html", m.html)
      : part("text/plain", m.text ?? ""),
  ].join("\r\n");
}

export const gmailSend = defineNode({
  id: "gmail.send",
  label: "Send an email",
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

export default [gmailSend];
