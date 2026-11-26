# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

## [0.3.0](https://github.com/getrunbase/runbase/compare/v0.2.0...v0.3.0) (2026-11-26)


### ⚠ BREAKING CHANGES

* require explicit AI config on AI blocks and interfaces ([#77](https://github.com/getrunbase/runbase/issues/77))

### Features

* **billing:** add a plan picker fed by the billing extension ([#70](https://github.com/getrunbase/runbase/issues/70)) ([0c89800](https://github.com/getrunbase/runbase/commit/0c898003e016c9881dd9159cf25282996f47836a))
* **billing:** show an optional plan comparison table in the plan picker ([#79](https://github.com/getrunbase/runbase/issues/79)) ([2ede3eb](https://github.com/getrunbase/runbase/commit/2ede3ebded86d547148ab8ad3804b4532f6162ce))
* **core:** extend retention to errors, page errors, outbox and idempotency keys ([#39](https://github.com/getrunbase/runbase/issues/39)) ([ef1f47b](https://github.com/getrunbase/runbase/commit/ef1f47b6ac4414ccaaa5a0fa2f05fae0453def27))
* **core:** file storage usage and storageBytes quota ([#32](https://github.com/getrunbase/runbase/issues/32)) ([48aa6a8](https://github.com/getrunbase/runbase/commit/48aa6a8fa9959d60786f7b6ac6c5644c64dca2c2))
* **core:** inactivity extension point to pause idle workspaces ([#54](https://github.com/getrunbase/runbase/issues/54)) ([916d7ad](https://github.com/getrunbase/runbase/commit/916d7adde9e2da8770939e7e414dd23ac82bce29))
* **core:** max run duration entitlement ([#37](https://github.com/getrunbase/runbase/issues/37)) ([3af2dc3](https://github.com/getrunbase/runbase/commit/3af2dc313721aa2cb333862c878bf34c4707eab4))
* **core:** minimum cron interval quota ([#38](https://github.com/getrunbase/runbase/issues/38)) ([462cd01](https://github.com/getrunbase/runbase/commit/462cd01fa0fd179d4114d31a1e1e280472a7c27e))
* **core:** monthly run counter and runsPerMonth quota ([#31](https://github.com/getrunbase/runbase/issues/31)) ([b32e012](https://github.com/getrunbase/runbase/commit/b32e0123e7326ec555b1831bbbeea568274bd326))
* **core:** pass the viewer's locale to the billing plans extension ([#71](https://github.com/getrunbase/runbase/issues/71)) ([dd798d0](https://github.com/getrunbase/runbase/commit/dd798d0ce13034a3b3c4b3d7720c2a78a0befc15))
* **core:** point quota errors to a plan upgrade when the host provides billing ([#48](https://github.com/getrunbase/runbase/issues/48)) ([43b6cc9](https://github.com/getrunbase/runbase/commit/43b6cc9430e9c6515cc3ae717dadb084b982f21b))
* **core:** published interfaces quota (quota:pages) ([#34](https://github.com/getrunbase/runbase/issues/34)) ([f3af2b4](https://github.com/getrunbase/runbase/commit/f3af2b4336ec2b201f36b3fbcca371e3a25a8abc))
* **core:** report usage to the billing provider ([#42](https://github.com/getrunbase/runbase/issues/42)) ([ad404a0](https://github.com/getrunbase/runbase/commit/ad404a0e760c4ee7fd421fbcc9b6919928aa5491))
* **core:** workspace activity tracking and paused state ([#40](https://github.com/getrunbase/runbase/issues/40)) ([7817b0f](https://github.com/getrunbase/runbase/commit/7817b0fa72dd9aefe26df33ee4faccfc18f8977e))
* **docs:** French docs with Fumadocs i18n, SEO and split MCP reference ([#29](https://github.com/getrunbase/runbase/issues/29)) ([1a90a5b](https://github.com/getrunbase/runbase/commit/1a90a5b0e0963c46c90df0833db0936e516887ea))
* list triggers in blocks.list and move Slack webhooks to a connector ([#69](https://github.com/getrunbase/runbase/issues/69)) ([73f55a2](https://github.com/getrunbase/runbase/commit/73f55a23f9b0bd079243d93a74bc9208d3b00769))
* pick the provider, model and key on each AI block ([#67](https://github.com/getrunbase/runbase/issues/67)) ([1100960](https://github.com/getrunbase/runbase/commit/1100960f10a7012712afb07140da5edd835d075c))
* require explicit AI config on AI blocks and interfaces ([#77](https://github.com/getrunbase/runbase/issues/77)) ([e2fe8e4](https://github.com/getrunbase/runbase/commit/e2fe8e4f7862706829015d0d42ab4b9249d07c17))
* **usage:** show every enforced quota with its scope ([#73](https://github.com/getrunbase/runbase/issues/73)) ([0b5d702](https://github.com/getrunbase/runbase/commit/0b5d702dc47d7a5a9dd4fd27b2c5e9e24a28569e))
* **web:** "Powered by Runbase" badge on published interfaces ([#43](https://github.com/getrunbase/runbase/issues/43)) ([2277b94](https://github.com/getrunbase/runbase/commit/2277b941572db4ce12bafb5b1febcb4023b7815d))
* **web:** guided AI connection and template-first home ([#87](https://github.com/getrunbase/runbase/issues/87)) ([29aba27](https://github.com/getrunbase/runbase/commit/29aba27a7c8c863ff40a48f824ab4095a6eecfa2))
* **web:** keep usage in its own tab and rename billing to Plan ([#78](https://github.com/getrunbase/runbase/issues/78)) ([963eeb4](https://github.com/getrunbase/runbase/commit/963eeb464e35fbb8bcaf0f48e99782e3f9925e16))
* **web:** make agent setup agent-agnostic ([#53](https://github.com/getrunbase/runbase/issues/53)) ([0c7b5f7](https://github.com/getrunbase/runbase/commit/0c7b5f7aff0022403f4343cf2b291999e250b89f))
* **web:** plain app copy and copyable AI prompts on empty states ([#85](https://github.com/getrunbase/runbase/issues/85)) ([c8123b4](https://github.com/getrunbase/runbase/commit/c8123b49ffb5e39dc9174bf347211efd68f45767))
* **web:** regroup the sidebar into Activity, Automations and Data ([#65](https://github.com/getrunbase/runbase/issues/65)) ([487fdff](https://github.com/getrunbase/runbase/commit/487fdffdcfc01db03e34f5bdb8a6380d7acfdef0))
* **web:** usage page in settings ([#44](https://github.com/getrunbase/runbase/issues/44)) ([5c901f1](https://github.com/getrunbase/runbase/commit/5c901f1073579179155e432e026d11bf58e1dbe2))


### Bug Fixes

* **core:** return renderTimeout before MCP clients give up ([#61](https://github.com/getrunbase/runbase/issues/61)) ([9f55bad](https://github.com/getrunbase/runbase/commit/9f55badbc6cb7ac7f0c219ffe9f879557ef49893))
* **core:** sweep orphan render PNGs after a timeout ([#35](https://github.com/getrunbase/runbase/issues/35)) ([8f98560](https://github.com/getrunbase/runbase/commit/8f9856035e6e3f126e2fde8d3dd13711ae50dfbb))
* **members:** scope invitations and member access to workspaces ([#76](https://github.com/getrunbase/runbase/issues/76)) ([9f65ebe](https://github.com/getrunbase/runbase/commit/9f65ebefc1c4383dd6a8c19548906318588dd78e))
* **settings:** restrict settings areas by role ([#86](https://github.com/getrunbase/runbase/issues/86)) ([58c0234](https://github.com/getrunbase/runbase/commit/58c0234bb24ed12e5a3f2d350e48a495583029f1))
* **web:** declare @aws-sdk/client-s3 so Next can resolve it ([#56](https://github.com/getrunbase/runbase/issues/56)) ([398c2ed](https://github.com/getrunbase/runbase/commit/398c2eda051e95e4063df1a62e4289523f29bcfe))
* **web:** let MCP clients reach OAuth metadata and escape fn.&lt;name&gt; in messages ([#57](https://github.com/getrunbase/runbase/issues/57)) ([e426e3f](https://github.com/getrunbase/runbase/commit/e426e3f5f068f0ba64b25a5d0f3cd2391123e4b3))
* **web:** redirect signed-in users away from the login page ([#50](https://github.com/getrunbase/runbase/issues/50)) ([891c430](https://github.com/getrunbase/runbase/commit/891c4305ea9587812029becf3e28e1319bc5666c))
* **web:** return server action errors inline and hide admin-only controls ([#81](https://github.com/getrunbase/runbase/issues/81)) ([eeccef6](https://github.com/getrunbase/runbase/commit/eeccef65dfb22fa9d1d7973bc5bda149bcd7ddea))
* **web:** workspace quota message, new record form and UI fixes ([#63](https://github.com/getrunbase/runbase/issues/63)) ([79ffd05](https://github.com/getrunbase/runbase/commit/79ffd0583758edf973b0042d63fc7aa6ed36cedf))

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
