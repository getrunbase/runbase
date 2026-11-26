# @getrunbase-connectors/slack

Send messages to a Slack channel through an Incoming Webhook.

## Nodes

- `node.slack.send`: Sends a message to the Slack channel of an Incoming Webhook. The webhook URL can be typed or picked from the workspace secrets.

## Setup

In Slack, create an Incoming Webhook for the channel and copy its URL
(`https://hooks.slack.com/services/…`).

Paste it in the step's `webhookUrl` field, or store it in **Settings › Secrets**
and insert the secret there. Each step can use its own webhook, so one workspace
can post to several channels or Slack workspaces. The node can only reach
`hooks.slack.com`.

## Development

```sh
pnpm test        # unit tests, HTTP mocked
pnpm runbase node test connectors/slack
```

License: MIT.
