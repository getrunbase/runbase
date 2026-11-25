// Slack connector: posts messages through an Incoming Webhook.
import { z } from "zod";
import { defineNode } from "@getrunbase/node-sdk";

export const send = defineNode({
  id: "slack.send",
  label: "Send a Slack message",
  description:
    "Sends a message to the Slack channel of an Incoming Webhook. The webhook URL can be typed or picked from the workspace secrets.",
  auth: { secrets: [], domains: ["hooks.slack.com"] },
  inputs: z.object({
    webhookUrl: z.string().min(1),
    text: z.string().min(1),
  }),
  outputs: z.object({ status: z.number() }),
  run: async ({ webhookUrl, text }, ctx) => {
    if (!webhookUrl.startsWith("https://hooks.slack.com/"))
      throw new Error("webhookUrl is not a Slack Incoming Webhook URL");
    const res = await ctx.fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok)
      throw new Error(
        `Slack webhook failed (${res.status} ${await res.text().catch(() => "")})`,
      );
    return { status: res.status };
  },
});

export default [send];
