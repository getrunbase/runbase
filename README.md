<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/logo-dark.svg">
    <img src="docs/brand/logo-light.svg" alt="Runbase" height="48">
  </picture>
</h1>

**The data, automation and interface platform that AI agents build on.**

Connect Claude, Cursor or any MCP client, describe the tool you need, and the
agent builds it end to end: typed databases, webhooks, sandboxed functions,
durable workflows and the pages your team uses every day. Self-host it in five
minutes, with unlimited workspaces for free.

[![License: FSL-1.1-ALv2](https://img.shields.io/badge/core-FSL--1.1--ALv2-blue)](LICENSE)
[![SDK license: MIT](https://img.shields.io/badge/SDK%20%26%20connectors-MIT-green)](packages/node-sdk/LICENSE)
[![MCP native](https://img.shields.io/badge/MCP-native-purple)](apps/docs/content/docs/reference/mcp.mdx)
[![Self-host: Docker](https://img.shields.io/badge/self--host-Docker-2496ED)](docs/self-hosting.md)
[![CI](https://github.com/getrunbase/runbase/actions/workflows/ci.yml/badge.svg)](https://github.com/getrunbase/runbase/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/getrunbase/runbase)](https://github.com/getrunbase/runbase/releases)
[![Discussions](https://img.shields.io/github/discussions/getrunbase/runbase)](https://github.com/getrunbase/runbase/discussions)

## What an agent can build

> "Build a small CRM: companies and contacts, a lead score, a workflow that
> scores new contacts, and a pipeline page."

From that prompt the agent creates the objects, imports sample data, writes a
scoring function, wires a workflow, publishes a kanban page and checks it with
a screenshot. Every step is a typed, versioned and reversible MCP tool call.

- **Data**: databases, objects with typed fields and relations, records with
  history, trash, merge and safe bulk edits. Read-only SQL included.
- **Events and webhooks**: signed inbound webhooks, deduplicated events,
  timelines and funnels.
- **Functions**: versioned JavaScript in a sandbox, with declared network,
  secrets and data permissions, and dry runs.
- **Workflows**: triggers, built-in and connector nodes, AI steps, waits, human approvals, retries
  and replays.
- **Interfaces**: pages, dashboards and TSX code components in an isolated
  runtime.
- **Workspaces**: as many as you want, free. One per client or per project,
  fully isolated, each with its own keys and quotas.

## Quickstart (self-host, under 5 minutes)

Requirements: Docker with the Compose plugin and `openssl`.

```sh
git clone https://github.com/getrunbase/runbase runbase && cd runbase
./setup.sh
docker compose -f docker-compose.selfhost.yml up -d --wait
docker compose -f docker-compose.selfhost.yml exec worker pnpm admin:create you@example.com
```

Open `http://localhost:3000/login`, then connect your agent:

```sh
claude mcp add --transport http runbase http://localhost:3000/api/mcp
```

HTTPS, backups and upgrades: [self-hosting guide](docs/self-hosting.md).

## Documentation

The docs site lives in [`apps/docs`](apps/docs) (`pnpm --filter @getrunbase/docs dev`):

- [Quickstart](apps/docs/content/docs/quickstart.mdx)
- [Concepts](apps/docs/content/docs/concepts/index.mdx)
- [Writing a connector](apps/docs/content/docs/guides/connectors.mdx)
- [Template format](apps/docs/content/docs/guides/templates.mdx)
- References generated from the code: [REST API](apps/docs/content/docs/reference/api.mdx),
  [MCP tools](apps/docs/content/docs/reference/mcp.mdx),
  [workflow nodes](apps/docs/content/docs/reference/nodes.mdx)

## How it compares

Facts as of November 2026, from each vendor's public documentation. Corrections
are welcome.

|                         | Runbase                       | n8n                     | Zapier       | Make        | Activepieces            | Airtable    | Retool           |
| ----------------------- | ----------------------------- | ----------------------- | ------------ | ----------- | ----------------------- | ----------- | ---------------- |
| Self-host               | Yes, Docker                   | Yes                     | No           | No          | Yes                     | No          | Yes (paid plans) |
| Source license          | FSL-1.1-ALv2, then Apache 2.0 | Sustainable Use License | Proprietary  | Proprietary | MIT (community edition) | Proprietary | Proprietary      |
| Built through MCP       | Yes, every feature            | Partial                 | Partial      | Partial     | Partial                 | Partial     | No               |
| Database with relations | Yes                           | Basic tables            | Basic tables | Data stores | Basic tables            | Yes         | Yes              |
| Workflows               | Yes                           | Yes                     | Yes          | Yes         | Yes                     | Basic       | Yes              |
| User-facing pages       | Yes                           | Forms                   | Yes          | No          | Forms                   | Yes         | Yes              |
| Sandboxed custom code   | Yes                           | Yes                     | Yes          | Paid plans  | Yes                     | Scripts     | Yes              |

"Built through MCP" means an agent can create and change the data model,
workflows and interfaces themselves, not only trigger existing actions.

## Licensing

Runbase is source-available, with open source extension points.

| Path                                                                                              | License                                                                                                  |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Repository root, `apps/*`, `packages/core`                                                        | [FSL-1.1-ALv2](LICENSE) (Functional Source License, converts to Apache 2.0 two years after each release) |
| `packages/sdk`, `packages/node-sdk`, `packages/kit`, `packages/ui`, `connectors/*`, `templates/*` | MIT (each folder ships its own `LICENSE`)                                                                |

The FSL allows any use except offering a competing commercial product or service; each version becomes Apache 2.0 on its second anniversary.

Every `package.json` declares a matching `license` field. `pnpm check:licenses` verifies the whole layout and `pnpm test:licenses` runs its tests.

## Telemetry

Anonymous telemetry is on by default: the worker sends one ping per day
(random instance id, version, platform, bucketed counts of workspaces,
workflows and runs; no user, tenant or host data). Set `RUNBASE_TELEMETRY=0`
to turn it off. Every
field is listed in the [self-hosting guide](docs/self-hosting.md#anonymous-telemetry),
and the worker logs on start whether telemetry is on.

Operational metrics (OpenTelemetry) are off unless you set
`OTEL_METRICS_EXPORTER`, and are exported only to the endpoint you choose: see
[observability](docs/observability.md).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md), the [code of conduct](CODE_OF_CONDUCT.md)
and the [security policy](SECURITY.md). Contributions are accepted under the
[CLA](CLA.md).
