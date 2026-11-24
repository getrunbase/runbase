// Test connector: loaded from a folder, no network.
import { z } from "zod";
import { defineNode } from "@runbase/node-sdk";

export default defineNode({
  id: "echo.shout",
  label: "Shout",
  description: "Uppercases a text, prefixed by the ECHO_PREFIX secret.",
  auth: { secrets: ["ECHO_PREFIX"] },
  branches: ["short", "long"],
  inputs: z.object({ text: z.string().min(1), max: z.number().default(5) }),
  outputs: z.object({ text: z.string(), sandboxed: z.boolean() }),
  run: async ({ text, max }, ctx) => ({
    branch: text.length > max ? "long" : "short",
    output: {
      text: `${ctx.secrets.ECHO_PREFIX ?? ""}${text.toUpperCase()}`,
      // Runs in Deno (functions sandbox), not in Node.
      sandboxed: typeof (globalThis as { Deno?: unknown }).Deno === "object",
    },
  }),
});
