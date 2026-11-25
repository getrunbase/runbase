# Extensions

Runbase is open source and self-hostable. A hosted offering adds product
analytics, billing, managed OAuth clients and managed AI keys on top of it,
without forking this repository and without putting hosted-only logic in the
core. The core depends only on the interfaces below; every default is a no-op
that makes no network call.

## Interfaces

`@getrunbase/core/extensions` exposes four extension points:

| Point         | Interface            | Purpose                                                          |
| ------------- | -------------------- | ---------------------------------------------------------------- |
| `telemetry`   | `TelemetrySink`      | `track(event, props)`: product analytics events.                 |
| `billing`     | `BillingProvider`    | `entitlements(organizationId)`, `reportUsage(workspaceId, metric, qty)`. |
| `credentials` | `ManagedCredentials` | `oauthClient(provider)`.                                         |
| `client`      | `ClientExtension`    | `headScripts()`: scripts injected in the `<head>` of `apps/web`. |

`TelemetrySink` is product analytics (who uses which feature). It is distinct
from the OpenTelemetry metrics of `@getrunbase/core/telemetry`, which describe
technical health (see `observability.md`).

`reportUsage` is called by the worker on `USAGE_REPORT_CRON` (hourly by
default), only when an extension module is loaded. For each workspace it
receives absolute values (gauges): `records` (current count), `runs` (runs
started this calendar month, UTC) and `storageBytes` (attached files). A
failing call is logged and does not stop the other reports.

A `null` answer from `billing` or `credentials` means "no opinion": the core
uses the limits from the environment (unlimited by default, every feature
allowed) or its configured secret. The platform never supplies an AI key: AI
always runs on the workspace's own provider key.

`client.headScripts()` returns `{ id, src?, inline?, attrs? }[]`, rendered with
`next/script` (`afterInteractive`). Default: none. Consent (for example before
loading GA4) is the script's responsibility.

## Entitlements

The core knows no offer names. `billing.entitlements(organizationId)` returns
`{ features: string[], quotas: Record<string, number> }`: features are
`feat:…` keys, checked with `can(ctx, "feat:…")`; quotas are `quota:…` caps,
enforced with `checkQuota(ctx, "quota:…", next)` (`@getrunbase/core/entitlements`).
A quota left out falls back to the environment, then to unlimited. Changing
an offer only changes the extension, never this repository.

| Quota                 | Enforced at                              | Env fallback               |
| --------------------- | ---------------------------------------- | -------------------------- |
| `quota:records`       | record creation (caps `quotas.set`)      | `QUOTA_MAX_RECORDS`        |
| `quota:runsPerMinute` | run launch                               | `QUOTA_MAX_RUNS_PER_MINUTE`|
| `quota:runsPerMonth`  | runs started per calendar month (UTC), all workspaces of the organization | `QUOTA_MAX_RUNS_PER_MONTH` |
| `quota:storageBytes`  | bytes of attached files stored, all workspaces of the organization | `QUOTA_MAX_STORAGE_BYTES` |
| `quota:apiPerMinute`  | API rate (MCP, REST, ingestion)          | `QUOTA_MAX_API_PER_MINUTE` |
| `quota:concurrency`   | default jobs at once per workspace       | `QUOTA_CONCURRENCY`        |
| `quota:workspaces`    | workspace creation                       | `QUOTA_MAX_WORKSPACES`     |
| `quota:pages`         | first publish of an interface (page)     | `QUOTA_MAX_PAGES`          |
| `quota:aiBudgetUsd`   | monthly AI budget of a workspace         | `QUOTA_MAX_AI_BUDGET_USD`  |
| `quota:aiTrialUsd`    | free AI credit on the platform key       | `QUOTA_AI_TRIAL_USD` (5.4) |
| `quota:retentionDays` | retention purge (none when unset)        | `RETENTION_DAYS`           |
| `quota:maxRunDurationMs` | function timeouts and run execution time (waits excluded) | `QUOTA_MAX_RUN_DURATION_MS` |
| `quota:cronMinIntervalSec` | workflow save (schedule trigger)    | `QUOTA_CRON_MIN_INTERVAL_SEC` |

A new quota type is still a public change, because the core must count it.

API: `getExtensions()` returns the active implementations,
`registerExtensions(partial)` replaces some of them, `track(event, props)`
sends an event best-effort (a failing sink is logged, never thrown).

## Loading

Set `RUNBASE_EXTENSIONS` to a package name or a file path. The web app (Next.js
instrumentation, Node runtime) and the worker load it at startup.

- Unset, or the module is not installed: silent no-op.
- The module exists but is malformed: startup fails with
  `extensions.invalid` ("Invalid extension module ...: ...").

The module exports, as `default` or `extensions`, an object (or a function
returning one, possibly async) with any subset of `telemetry`, `billing`,
`credentials`, `client`:

```js
export default {
  telemetry: { track: (event, props) => send(event, props) },
};
```

Events emitted today (identifiers only, never emails, names or record content):

| Event              | Props                                                   |
| ------------------ | ------------------------------------------------------- |
| `web.started`      | none                                                    |
| `worker.started`   | none                                                    |
| `user.signed_up`   | `userId`, `organizationId`                              |
| `workflow.created` | `organizationId`, `workspaceId`, `workflowId`           |
| `run.started`      | `organizationId`, `workspaceId`, `workflowId`, `runId`, `test` |

Offer changes are billing events: the hosted billing extension emits them itself.

## Inventory: what stays public

Rule: a feature stays public when a self-hoster
needs it to run their own instance; it moves to the hosted overlay when it
only makes sense for an operator selling the service.

| Feature                                            | Location                                                  | Decision                                                                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quotas and entitlements (retention, concurrency)   | `packages/core/src/entitlements`, `quotas`, `retention`  | Public mechanism with no offer names. Self-hosters set limits by env. Offers and their limits live in the hosted overlay, behind `BillingProvider.entitlements`. |
| Billing (checkout, invoices, payment provider)     | none in the core                                          | Hosted overlay, behind `BillingProvider`. The inbound Stripe webhook signature in `webhooks` is a user feature and stays public.                          |
| OAuth server for MCP clients (consent, login)      | `apps/web/app/oauth`                                      | Public: any instance must authorize its own MCP clients.                                                                                                  |
| Managed OAuth clients for third-party connectors   | none in the core                                          | Hosted overlay, behind `ManagedCredentials.oauthClient`. Self-hosters register their own OAuth apps.                                                     |
| AI key                                             | `packages/core/src/ai.ts`, `runs`                         | Public mechanism (tenant secret, budget). No platform key, no trial credit. |
| Platform admin (feedback inbox)                    | `apps/web/app/admin`                                      | Public: every instance has an operator.                                                                                                                   |
| Product analytics                                  | none in the core                                          | Hosted overlay, behind `TelemetrySink`.                                                                                                                   |

## Rules

- No reference to a specific overlay package in public code: the module name
  only appears in configuration.
- The core holds no business logic for these points; it only defines the
  interfaces, the no-op defaults and the loader.
- Errors are `appError` codes in English, translated in
  `apps/web/messages/fr/errors/platform.json`.
