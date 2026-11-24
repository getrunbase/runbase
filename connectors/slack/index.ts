// Slack connector: posts messages through the Web API (bot token).
import { z } from "zod";
import { defineNode } from "@runbase/node-sdk";

export const postMessage = defineNode({
  id: "slack.post_message",
  label: "Post a Slack message",
  description:
    "Posts a message to a Slack channel (or a thread reply with threadTs) as the connected bot.",
  auth: { secrets: ["SLACK_BOT_TOKEN"], domains: ["slack.com"] },
  inputs: z.object({
    channel: z.string().min(1),
    text: z.string().min(1),
    threadTs: z.string().optional(),
  }),
  outputs: z.object({ channel: z.string(), ts: z.string() }),
  run: async ({ channel, text, threadTs }, ctx) => {
    const res = await ctx.fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        authorization: `Bearer ${ctx.secrets.SLACK_BOT_TOKEN ?? ""}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel,
        text,
        ...(threadTs && { thread_ts: threadTs }),
      }),
    });
    // Slack answers 200 with ok: false on a business error.
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      channel?: string;
      ts?: string;
    };
    if (!res.ok || !data.ok)
      throw new Error(
        `Slack chat.postMessage failed (${data.error ?? res.status})`,
      );
    return { channel: data.channel ?? channel, ts: data.ts ?? "" };
  },
});

export default [postMessage];
