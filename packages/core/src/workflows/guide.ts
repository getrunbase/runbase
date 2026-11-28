// Workflow and function guide served by workflows.guide: when to use a
// function versus native blocks, sizing, triggers, failures, schemas,
// permissions and naming. Strict rules, like page.guide for pages.
export const WORKFLOWS_GUIDE = `# Workflows and functions: build guide

Goal: a workspace another person can read, debug and extend. The rules below are strict: follow them.

## Method (required)
1. workspace.describe, then objects.get on every object you touch (field keys, select options, unique fields).
2. Start from an example: workflows.examples (inbound-lead, company-enrichment, weekly-digest). Each one is a full set: objects, webhook, functions and workflow definition. Adapt slugs, field keys and domains to the workspace.
3. blocks.list for the native blocks and their input schemas.
4. functions.save, then functions.test { dryRun: true } on every function.
5. workflows.create, workflows.validate (errors and warnings empty), workflows.dry_run, runs.start { test: true }, runs.get. Fix and repeat, then workflows.activate.
6. workspace.purge_test to remove test data.
7. notes.save on each workflow and function you built: the why (decisions, local conventions, known pitfalls), not the structure. The next agent reads it with notes.list.

## Native block or function
- Use a native block when one exists: record.search, record.upsert, record.update, condition, switch, list.*, data.transform, date, http.request, event.emit, ai.*, human.approve, wait, workflow.run, stop.error.
- Block types are singular: record.update (not records.update), event.emit (not events.push, the MCP tool). An unknown type fails validate with a "did you mean" hint.
- Use a function (fn.<name>) only for what no block covers: a call to an external API with auth and response parsing, a non-trivial computation, a transformation too large for data.transform.
- Keep the flow in the workflow, not inside a function: reads, writes, branches and waits are blocks, so each step shows in runs.get and can be retried on its own (runs.retry_from).
- A workflow with a single fn.* step that does everything is wrong: split reads, logic and writes into steps.

## One function = one job, under 10 s
- A function does one thing (score a lead, fetch a company profile, format a digest). Its name says that thing.
- Target under 10 s per execution. Set limits.timeoutMs close to the real need (for example 10000), not the maximum.
- No loops over hundreds of records with an API call each: let the workflow fan out (event.emit per item, or trigger.record_created) and keep each function call small.
- No sleeps, no polling inside a function: use the wait or wait.until block.

## Triggers: react, do not poll
- Work on a record when it changes: trigger.record_created, trigger.record_updated { fields: [...] } (list the fields, otherwise every change triggers).
- External systems: webhooks.create + trigger.webhook (mapping + match on a unique field) instead of a cron that polls an API.
- Test a webhook before mapping it: webhooks.test sends a signed sample payload (or have the sender call the test URL, testPath, which stores the sample without starting a run), then webhooks.list shows the sample to write mapping and match. Never guess payload paths.
- Never chain staggered crons that read a status set by another cron ("every 5 min, pick rows where status = to_enrich"). Use record or event triggers, or event.emit to hand off to the next workflow.
- trigger.schedule is for time-based jobs only: digests, reports, reminders, cleanups. Set timezone.
- Several runs on the same record or account: set concurrencyKey ("{{record.id}}").

## Errors fail the run
- A function signals failure with \`return { ok: false, error: "message" }\` or by throwing. The step is retried (retry { attempts, backoff }), then the run fails and the error appears in errors.list.
- Never write an error message into a record field (notes, status text, last_error) and return success. Never swallow an exception with an empty catch.
- Expected business outcomes are branches, not errors: declare \`branch\` with an enum in the outputSchema (for example ["found", "not_found"]) and connect each branch in \`next\`.
- Use stop.error in the workflow to fail a run on purpose with a clear message.
- For optional steps only, retry.continueOnFail: true with the \`error\` branch connected. Never write {{steps.<id>.output.error}} into a record field.
- Connect every empty / not_found / false branch. To end the run there on purpose, write it explicitly: \`next: { find: { empty: [] } }\`.
- human.approve with a timeout: the \`expired\` branch must change state. Pattern: \`next: { approve: { approved: ["publish"], rejected: ["mark_rejected"], expired: ["mark_expired"] } }\` with mark_expired a record.update setting status to expired (then event.emit or stop.error if someone must act).
- switch: the fallback branch is named \`else\` (shown as Otherwise in the editor), never \`default\` or \`otherwise\`.
- Any step with retry.continueOnFail: true gets an \`error\` branch (blocks.list: failBranch).

## Loops
- loop { items, do }: inside \`do\`, \`{{item}}\` is the current item (a record: \`{{item.id}}\`, \`{{item.data.<field>}}\`), \`{{index}}\` its 0-based position, \`{{steps.<id>.output}}\` the steps of the iteration. After the loop, \`{{steps.<loop id>.output.results}}\`.
- Dedupe example: a record.search step \`dupes\`, then loop { items: "{{steps.dupes.output.records}}", do: [{ id: "merge", type: "record.merge", input: { keep: "{{record.id}}", merge: ["{{item.id}}"] } }] }.
- ai.* steps always set input.ai (provider, model, secret): there is no default provider.
- Never write computed fields (formula, lookup, rollup, autonumber, created_at...): the platform sets them.

## Tests: use the platform, not flags
- Test with functions.test, workflows.dry_run, workflows.test_step and runs.start { test: true }. Data written in a test run is marked test and removed by workspace.purge_test.
- Inside a function, read \`test\` from the 2nd argument to skip an irreversible call (sending an email to a real customer, charging a card). Never add home-made inputs such as simulate, dry_run, mock or fake to a function or a record.

## Declared schemas
- inputSchema and outputSchema are JSON Schemas with \`type: "object"\`, \`properties\` and \`required\`. Never leave outputSchema empty: workflows.validate checks {{steps.<id>.output.<field>}} refs against it and the editor shows its fields.
- Return exactly the declared shape. Keep outputs small: ids and the values the next steps need, not full API responses.

## Permissions: least privilege
- permissions.domains: list each exact hostname the code calls (api.example.com). Never \`"*"\`: it opens the whole internet and hides what the function does.
- permissions.secrets: only the secrets the code reads. Create them first with secrets.set.
- permissions.records / events: omit when not needed, 'read' when the function only reads, 'write' only when it writes. Prefer returning values and writing them with a record.update step.

## Naming
- One language for every key: English. Never mix languages in a workspace.
- Object slugs: singular, snake_case (contact, deal, company_profile). Field keys: snake_case (full_name, lead_score, last_enriched_at). Select options: snake_case (sales_ready).
- Function names: kebab-case, verb first (score-lead, fetch-company-profile, format-digest).
- Step ids: snake_case, describing the action (score, update_stage, fetch_profile).
- Workflow names: sentence describing the result ("Score inbound leads", "Weekly pipeline digest").
- Events: dotted lowercase type (lead.qualified, digest.sent). Secrets: UPPER_SNAKE_CASE (PDL_API_KEY).
`;
