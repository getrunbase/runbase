# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

## [0.2.0](https://github.com/getrunbase/runbase/compare/v0.1.0...v0.2.0) (2026-11-25)


### ⚠ BREAKING CHANGES

* rename all workspace packages to the @getrunbase scope ([#14](https://github.com/getrunbase/runbase/issues/14))
* publish the SDKs under the @getrunbase npm scope ([#13](https://github.com/getrunbase/runbase/issues/13))

### Bug Fixes

* **core:** merge workspace settings and make AI budget provider-agnostic ([#12](https://github.com/getrunbase/runbase/issues/12)) ([ddbab4f](https://github.com/getrunbase/runbase/commit/ddbab4fcccfdb6efd02bc0c4f01d8b3d0b6578bb))
* **sdk:** rewrite .ts import extensions so the package builds ([#1](https://github.com/getrunbase/runbase/issues/1)) ([3fbccbd](https://github.com/getrunbase/runbase/commit/3fbccbda8fa3c08ec9a08ce1438c5b46369951a8))
* **web:** validate remaining server action inputs with zod ([#10](https://github.com/getrunbase/runbase/issues/10)) ([cd2e1e8](https://github.com/getrunbase/runbase/commit/cd2e1e841f8e7bbc6b001e56ee70146ea932325c))


### Code Refactoring

* publish the SDKs under the [@getrunbase](https://github.com/getrunbase) npm scope ([#13](https://github.com/getrunbase/runbase/issues/13)) ([fd07ba0](https://github.com/getrunbase/runbase/commit/fd07ba099c7857257775939919a8dda0a168abfb))
* rename all workspace packages to the [@getrunbase](https://github.com/getrunbase) scope ([#14](https://github.com/getrunbase/runbase/issues/14)) ([0667e7c](https://github.com/getrunbase/runbase/commit/0667e7ca5a23e2dd36980d93a95caeb1ff0d018b))

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
