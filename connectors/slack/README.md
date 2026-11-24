# @runbase-connectors/slack

Post messages and thread replies to Slack channels as your own bot, using the Slack Web API.

## Nodes

- `node.slack.post_message`: Posts a message to a Slack channel (or a thread reply with threadTs) as the connected bot.

## Setup

Create a Slack app, add the `chat:write` bot scope, install it in your workspace and invite the bot to the channel. Copy the bot token (`xoxb-…`).

Add the secret in **Settings › Secrets** of your workspace:
`SLACK_BOT_TOKEN`. The node can only reach `slack.com`.

## Development

```sh
pnpm test        # unit tests, HTTP mocked
pnpm runbase node test connectors/slack
```

License: MIT.
