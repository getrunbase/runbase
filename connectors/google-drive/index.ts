// Google Drive connector. OAuth "google" connection, shared with the other
// Google connectors: one account covers Gmail, Calendar, Sheets and Drive.
// Only scopes that need no Google security assessment.
import { z } from "zod";
import { defineNode, type NodeOAuth } from "@getrunbase/node-sdk";

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

// UTF-8 safe base64 (Deno sandbox: no Buffer).
const b64 = (s: string) => {
  let bin = "";
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
};
const noCrlf = (v: string) => v.replace(/[\r\n]+/g, " ");

// Google Drive (drive.file: only files created by Runbase)
export const uploadFile = defineNode({
  id: "google_drive.upload_file",
  label: "Create a file",
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
  outputs: z.object({
    id: z.string(),
    name: z.string(),
    webViewLink: z.string().nullable(),
  }),
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
    if (!res.ok) {
      let msg = text;
      try {
        msg = JSON.parse(text).error?.message ?? text;
      } catch {
        // not JSON: raw body
      }
      throw new Error(`Google API failed (${res.status} ${msg.slice(0, 300)})`);
    }
    const f = JSON.parse(text) as {
      id: string;
      name: string;
      webViewLink?: string;
    };
    return { id: f.id, name: f.name, webViewLink: f.webViewLink ?? null };
  },
});

export default [uploadFile];
