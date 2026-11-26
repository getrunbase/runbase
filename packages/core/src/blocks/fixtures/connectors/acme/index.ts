// Test connector: OAuth provider "acme", no real network.
import { z } from "zod";
import { defineNode } from "@getrunbase/node-sdk";

const oauth = {
  provider: "acme",
  authorizeUrl: "https://auth.acme.test/authorize",
  tokenUrl: "https://auth.acme.test/token",
  revokeUrl: "https://auth.acme.test/revoke",
  authorizeParams: { access_type: "offline" },
};

export default [
  defineNode({
    id: "acme.read",
    label: "Acme read",
    auth: { domains: ["api.acme.test"], oauth: { ...oauth, scopes: ["read"] } },
    inputs: z.object({}),
    outputs: z.object({ ok: z.boolean() }),
    run: async () => ({ ok: true }),
  }),
  defineNode({
    id: "acme.write",
    label: "Acme write",
    auth: { domains: ["api.acme.test"], oauth: { ...oauth, scopes: ["read", "write"] } },
    inputs: z.object({}),
    outputs: z.object({ ok: z.boolean() }),
    run: async () => ({ ok: true }),
  }),
];
