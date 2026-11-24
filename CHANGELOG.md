# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-23

First public release.

### Added

- **Data**: databases, objects with typed fields and relations, records with
  history, trash, merge and safe bulk edits; read-only SQL (`query.sql`,
  PgBouncer compatible) with SQL views.
- **Events and webhooks**: signed inbound webhooks, signed test deliveries,
  deduplicated events, timelines and funnels.
- **Functions**: versioned JavaScript in a non-root Deno sandbox with declared
  network, secrets and data permissions, and dry runs.
- **Workflows**: triggers, built-in and connector nodes, AI steps
  (`ai.extract`, formatter), waits, human approvals, retries and replays;
  durable runs with a job outbox and per-workspace queue fairness.
- **Interfaces**: pages as TSX file packages compiled and run in an isolated
  iframe on a dedicated origin; `@runbase/kit` data-bound blocks (datatable,
  kanban, calendar, forms, unibox); `@runbase/sdk` realtime hooks and `useAI`
  with a cost guard; drafts, publishing and version history.
- **MCP**: native MCP server with typed, versioned tools; unified `page.*`
  tools with automatic review, screenshots and axe audit; `feedback.send`.
- **REST API**: `/api/v1` with an OpenAPI spec generated from zod.
- **Connectors and SDK**: `@runbase/node-sdk` (`defineNode`, `runbase node`
  CLI) and 11 connectors: Slack, Stripe, HubSpot, Notion, Airtable, OpenAI,
  Anthropic, Resend, GitHub, Linear, Discord.
- **Templates**: `runbase-template.json` format, MCP and UI import/export,
  public catalog API and creator program with signed publishing.
- **Workspaces**: unlimited, isolated workspaces with row-level security,
  envelope-encrypted secrets, per-plan quotas and retention.
- **Auth**: magic-link sign-in, roles per page and action.
- **Web app**: English and French UI (next-intl), light/dark theme, audit
  log, webhooks and runs screens.
- **Self-hosting**: setup in under 5 minutes with Docker Compose; non-root
  web, worker, renderer and sandbox images on GHCR (amd64 and arm64); S3/R2
  file storage; pino logs, Sentry, OpenTelemetry metrics, health and ready
  probes.
- **Telemetry**: anonymous daily telemetry, opt-out with
  `RUNBASE_TELEMETRY=0`.
- **Docs**: documentation site in `apps/docs` with generated references.

[Unreleased]: https://github.com/getrunbase/runbase/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/getrunbase/runbase/releases/tag/v0.1.0
