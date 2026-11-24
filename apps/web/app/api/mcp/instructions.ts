// MCP server instructions: overview sent to the client on connection.
// Each tool's details stay in its description; here, the map and the recipes.
export const MCP_INSTRUCTIONS = `# Runbase: tool map

Data, automation and interface platform, split into workspaces. Every tool takes an optional \`workspace\` parameter (otherwise workspaces.use).

## Getting started
Call **workspace.describe** first: databases, objects and fields, workflows (trigger, status), functions, webhooks, pages, secret names and counters, in one call.

## In 10 minutes: data, workflow, view
1. **Data**: databases.create, objects.create (typed fields, a unique field such as email), records.upsert_batch with \`test: true\` for sample data.
2. **Logic**: functions.save when a computation or an external call is needed (secrets.set first), functions.test { dryRun: true } to see planned writes without making them.
3. **Workflow**: workflows.create (trigger + blocks, fn.<name> included), workflows.validate, workflows.dry_run, workflows.activate; runs.start { test: true } for a real trial, runs.get for details (function logs included).
4. **View**: page.create (TSX package: {files, entry}) (dashboards: KpiCard and ChartCard from @runbase/kit), then page.screenshot to check and page.errors for browser runtime errors (file:line). page.update writes a draft hidden from users (file patch \`changes\`: write, edit old/new, rename, delete; returns compile errors): page.screenshot {draft: true}, then page.publish (or \`publish: true\` on page.update).
5. **Clean up**: workspace.purge_test { dryRun: true } then { confirm: true } deletes test records, events and runs.

## Building blocks
- **Data**: databases > objects (schema of typed fields, relations) > records. Read with objects.get before any write: field keys, select options, uuid. Field unique: true (email, domain): database constraint and upsert key (match). Duplicates: records.merge (atomic, relations and timeline included). Linked writes: records.transact (all or nothing). Large volumes: records.search with q (trigrams) and after = next (keyset, works with any sort); total and hasMore returned; objects.index on a field often filtered or sorted. Computed fields: formula (expression on the record), lookup and rollup (through a relation), created_at, updated_at, created_by, autonumber; per-field validation (pattern, min, max, minLength, maxLength) and default. Files: files.upload, then the value in a file field. Saved views (views.save: filter, sort, columns): visible in the table, reusable by records.search { view } and page queries { view }. Safety: records.delete moves to the trash (records.trash, records.restore, purged after 30 days); records.history and records.revert undo a change; bulk operations by filter (records.update_where, records.delete_where) with a mandatory dryRun preview; CSV import (records.import_csv, match to dedupe); full export (objects.export) before deleting any object or database (confirm: true); changing a schema that has data: objects.migrate (dryRun first) rather than objects.update_schema.
- **Events**: timestamped facts (events.push), linked to a record or not. events.list filters by type, record, dates (paginated); events.types lists received types; SQL view \`events\` in query.sql. Used as timeline, funnel (events.funnel) and trigger. idempotencyKey = external id: no duplicate on replay.
- **Inbound webhooks**: webhooks.create gives a public URL /api/hooks/<id> with verified signature (stripe, standard/Svix, configurable hmac incl. t=…,v1=… headers via headerFormat kv) that pushes an event deduplicated by external id (config.dedupe: id | id+hash to accept enriched resends | none). Trigger trigger.webhook { webhook: <name>, object?, match?, mapping?: { field: "payload.path.0" } }: creates or updates the record, then starts the run on it; full payload in {{event.…}}; webhooks.list returns the last received payload (sample) to write the mapping. To listen to a call without starting anything: have the test URL (testPath) called, then read the sample; webhooks.test simulates that call with a signed payload. Batches: config.splitPath (or root array) = one event per item. webhooks.update edits without changing the URL.
- **Functions**: versioned JS code, run in a server-side sandbox. They declare inputSchema, outputSchema, permissions (network domains, secrets, records, events) and limits (timeoutMs, memoryMb, bounded). With permissions.events: 'read'|'write', the code reads (events.list) and pushes (events.push) events. With permissions.records: 'read'|'write', the code reads and writes records through the records object (get, search; upsert, update, transact, delete, merge in write; object by slug or uuid). Declared secrets in the 2nd argument \`{ secrets }\`; \`test\` there is true in a test run. In a workflow, return \`{ ok: false, error }\` (or throw) to fail the step: retry, then run failed and errors.list entry. This is the reusable logic block: external API calls, computations, transformations. Test with functions.test (dryRun to simulate writes). permissions.domains: exact hostnames or host:port (no wildcard such as \`*.example.com\` or \`*.com\`: list each host), or \`"*"\` for the whole public internet; private, loopback, link-local and cloud metadata addresses are always blocked, including after DNS resolution and redirects. HTML parsing: \`parseHTML(html)\` (linkedom, returns { document }) and \`DOMParser\` are available as globals and as \`ctx.parseHTML\`. No browser rendering. Console logs of each execution (workflow, page, test): functions.logs and runs.get.
- **Secrets**: encrypted API keys (secrets.set), readable only by the functions that declare them.
- **Workflows**: a trigger (record created or updated, event, webhook, cron with or without object and time zone, manual, failure of another workflow) followed by blocks (blocks.list: records, conditions, switch, loops, lists (filter, map, aggregate, dedupe, sort, limit), data and dates, http, email, AI, human approval, wait (duration or date), sub-workflow, stop with error, functions). Variables: {{record}}, {{event}}, {{steps.<id>.output}}, {{now}}, {{today}}, {{run.id}}, {{run.test}}, {{workflow.id}}; {{event.recordId}} = record linked to the triggering event. condition and switch also take a value mode on any run value (condition { left: "{{steps.x.output.y}}", op, right }, switch { value, cases }). Definition \`concurrencyKey\` ("{{record.company_id}}"): one active run per key, the others wait. Step join: true: waits for parallel paths and runs only once. Per step: timeout and retry { attempts, backoff, continueOnFail }. workflow.run (wait: true, the default), human.approve, wait and nested loops cannot run inside loop.do: the run fails with "Block cannot be used in a loop". To process a list item by item with a sub-workflow, emit one event per item (event.emit in loop.do, trigger.event on the sub-workflow), or process the whole list in a function (fn.<name>). Secrets declared by the functions used (permissions.secrets) must exist (secrets.set): otherwise workflows.validate reports "Missing secret" and workflows.activate refuses. Validate (workflows.validate, unknown variables included), test a step (workflows.test_step), simulate (workflows.dry_run: never writes, AI simulated unless ai: true, event without record possible, pinned outputs \`pins\`), then activate.
- **Runs**: workflow executions. runs.waiting and runs.decide handle human approvals (expiry via input.timeout). Control: runs.cancel, runs.cancel_bulk, runs.pause, runs.resume; retry: runs.retry_from (from a step), runs.replay (new identical run). runs.list, errors.list, events.list, audit.list and functions.logs are paginated: { items, hasMore, nextCursor }, next page with cursor = nextCursor. A trigger skipped because a run is already active on the record appears in errors.list. errors.* lists and retries failures.
- **Audit**: audit.list without filter = workspace feed (who did what, when); filters type/id, action (prefix \`record.\`), actor, dates.
- **Queries**: query.sql (read-only), reusable saved queries.
- **Pages**: TSX packages of files ({path: source}, entry index.tsx), draft then published; shared components are files of the package.
- **Code components**: React + Tailwind + shadcn, written by the agent, data through @getrunbase/sdk, bounded by their permissions. Read page.guide before writing one; they live as files of a page package.

## How blocks connect
- A function is used in three places: a workflow block, a page query \`type: "fn"\` (data source), a page action \`type: "fn"\` (button, form; with \`record\`, the output is merged into that record).
- A code component does not call a function directly: it starts a workflow with \`startWorkflow\` (which can run a function), listed in its permissions.
- Secrets, network and business logic therefore stay server-side, never in the browser.

## Choosing
- A declarative page is enough for a standard list, record view or form. A code component is for a custom UI (kanban, 360, inbox).
- A native block is enough for a simple operation. A function is for reused logic, an external call or a secret.
- A workflow is for an automatic or scheduled reaction. A page action is for a user gesture.

## Recipes
1. **Enrich a record from an API**: secrets.set, then functions.save (domain and secret permissions), functions.test, then a page action \`fn\` with \`record\`, or a workflow on trigger.record_created.
2. **Pipeline with human approval**: a workflow with an approval block; runs.waiting then runs.decide to decide.
3. **Product tracking**: events.push from the app, events.funnel for analysis, trigger.event to react.
4. **Scheduled task**: trigger.schedule (cron + object + filter); each filtered record starts a run.
5. **Business interface**: objects.get and records.search, page.guide and page.examples (kit-based packages), page.create with the package files, then page.screenshot and page.errors.

## Rules
- Errors: text \`[code] message\`. Codes: not_found (missing target: the message says where to look), invalid_input, confirm_required, conflict, not_waiting, quota_exceeded, forbidden, invalid_workflow, error. Unexpected tool failures are also visible in errors.list (source mcp).
- Irreversible or bulk operations (records.purge, runs.cancel_bulk, workflows.delete, functions.delete, objects.delete, databases.delete, workspace.purge_test): confirm: true required; preview first (dryRun or export).
- Test data: \`test: true\` on records.upsert(_batch), events.push and runs.start, then workspace.purge_test. A test run marks test everything it writes (records, events, function writes) and every run it causes (sub-workflows, runs triggered by its test records and events).
- Always verify: workflows.validate and dry_run, functions.test, page.test, page.screenshot and page.errors.
- Resources are versioned: *.versions and *.restore to roll back.
- Bug, limit hit or idea: feedback.send, without waiting to be asked. The team reads every report.
- References use uuids (objects.get, records.search), never slugs, unless the tool says otherwise.

## Access and limits
- Roles (members.invite, members.set_role): admin manages everything, member creates and edits, viewer reads only, end_user only opens pages (no MCP). An invitation grants access only once accepted.
- API key: limited to its workspaces; optionally to some tools (tools) and objects (objects). A tool or object outside the list is invisible.
- Per-workspace quotas (quotas.get): number of records, workflow runs and calls per minute. quota_exceeded error: wait for the next minute or ask an admin to raise the limit (quotas.set).
`;
