// MCP tools: workflows.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { TenantContext } from "@getrunbase/core/tenant";
import {
  definitionSchema,
  workflowsService,
  WORKFLOW_EXAMPLES,
  WORKFLOWS_GUIDE,
} from "@getrunbase/core/workflows";
import { notFound, requireConfirm } from "@getrunbase/core/errors";
import { lintWorkflow } from "@getrunbase/core/lint";
import { run, must, wfId, linted } from "./shared";

export function defineWorkflowTools(server: McpServer, ctx: TenantContext) {
  // Guide and reference examples, to read before building a workflow.
  server.registerTool(
    "workflows.guide",
    {
      description:
        "Workflow and function guide, to read before building a workflow: native block versus function, one function = one job under 10 s, record or webhook triggers instead of polling crons, errors fail the run, declared input/output schemas, explicit domains, test runs instead of simulation flags, naming conventions.",
    },
    () => run(async () => ({ guide: WORKFLOWS_GUIDE })),
  );
  server.registerTool(
    "workflows.examples",
    {
      description:
        "Reference workflows (inbound-lead, company-enrichment, weekly-digest). Without `name`: list {name, description}. With `name`: the full set (secrets, objects, webhooks, functions, workflow definition) to create in that order with secrets.set, objects.create, webhooks.create, functions.save and workflows.create. Adapt slugs, field keys and domains to the workspace.",
      inputSchema: z.object({ name: z.string().optional() }),
    },
    ({ name }) =>
      run(async () => {
        if (!name)
          return {
            total: WORKFLOW_EXAMPLES.length,
            items: WORKFLOW_EXAMPLES.map(({ name, description }) => ({
              name,
              description,
            })),
          };
        const ex = WORKFLOW_EXAMPLES.find((e) => e.name === name);
        if (!ex)
          throw notFound(
            "mcp.workflowExampleNotFound",
            "Unknown workflow example: {name}. See workflows.examples.",
            { name },
          );
        return ex;
      }),
  );
  // Workflows
  server.registerTool(
    "workflows.list",
    { description: "Lists the workspace workflows." },
    () => run(() => workflowsService.list(ctx)),
  );
  server.registerTool(
    "workflows.get",
    {
      description:
        "Reads a workflow and the definition of its current version.",
      inputSchema: z.object({ id: wfId }),
    },
    ({ id }) => run(() => workflowsService.get(ctx, id)),
  );
  server.registerTool(
    "workflows.versions",
    {
      description: "Lists the (immutable) versions of a workflow.",
      inputSchema: z.object({ id: wfId }),
    },
    ({ id }) => run(() => workflowsService.versions(ctx, id)),
  );
  server.registerTool(
    "workflows.validate",
    {
      description:
        "Validates a definition: unconnected steps, branches, block inputs, conditions, fn.<name> inputs (required fields of the inputSchema, {{steps.x.output.y}} and {{record.y}} refs to declared fields). Returns { errors, warnings }: errors empty = valid; warnings = non-blocking (refs that cannot be checked before the run, such as {{event.…}}); lint = workspace standards ({ code, path, message, hint }), also returned by workflows.create/update.",
      inputSchema: z.object({ definition: definitionSchema }),
    },
    ({ definition }) =>
      run(async () => {
        const r = await workflowsService.check(ctx, definition);
        return {
          errors: r.errors.map((e) => e.message),
          warnings: r.warnings.map((e) => e.message),
          lint: lintWorkflow(definition),
        };
      }),
  );
  server.registerTool(
    "workflows.dry_run",
    {
      description:
        "Runs a definition without ever writing anything: writes, sends, external calls, loops and functions with network or 'write' permissions are simulated (first branch, null output); reads are real. AI blocks (ai.*) simulated by default, real and billed only with ai: true. One run per record in `records`; without records, a single run without a record (useful for a workflow triggered by an event or webhook); `event` = payload of the triggering event ({{event.…}}). Pinned outputs (`definition.pins[stepId] = { output, branch? }`) replayed instead of running the step. A `join: true` step runs once, after the other paths. Returns per run the paths taken (`paths`, one per parallel execution branch; `path`: all steps flattened), with for each step input, output, branch and reason.",
      inputSchema: z.object({
        definition: definitionSchema,
        records: z
          .array(z.string())
          .max(100)
          .optional()
          .describe("Record ids (optional)"),
        event: z
          .unknown()
          .optional()
          .describe("Payload of the triggering event"),
        ai: z
          .boolean()
          .optional()
          .describe("true: really runs the AI blocks (paid)"),
      }),
    },
    ({ definition, records, event, ai }) =>
      run(() =>
        workflowsService.dryRun(ctx, definition, records ?? [], { ai, event }),
      ),
  );
  server.registerTool(
    "workflows.test_step",
    {
      description:
        "Tests a single step of a definition: `input` provided (otherwise the definition's, templates rendered), context `recordId` and/or `event`, outputs of previous steps via `steps` { stepId: output } (otherwise pinned outputs `definition.pins`). Side effects simulated unless `live: true` (real execution: writes, sends, paid AI). Returns rendered input, branch, output.",
      inputSchema: z.object({
        definition: definitionSchema,
        stepId: z.string(),
        input: z.record(z.string(), z.unknown()).optional(),
        recordId: z.string().optional(),
        event: z.unknown().optional(),
        steps: z.record(z.string(), z.unknown()).optional(),
        live: z.boolean().optional(),
      }),
    },
    ({ definition, stepId, ...opts }) =>
      run(() => workflowsService.testStep(ctx, definition, stepId, opts)),
  );
  server.registerTool(
    "workflows.create",
    {
      description:
        'Creates a workflow (draft status, version 1). Definition: trigger, steps, next, entry. next[step][branch] = a step id or an array of ids (steps started in parallel). entry = steps started by the trigger (absent: the first step). Event trigger: {"type": "trigger.event", "event": "<event type>"} (`eventType` accepted). Without a join, two paths that converge run the common step twice; step `join: true`: waits for all paths and runs only once. Step options (next to input): `timeout` ("30s", "5m"; default 5m, network calls included) and `retry` { attempts (1-10, default 3), backoff ("1s", doubled on each attempt), continueOnFail (after the last failure, follows the error branch if connected, otherwise the first) }. `timeout` at definition level: global run deadline ("2h"). human.approve accepts input.timeout ("2d"): without a decision, expired branch if connected, otherwise failure. `concurrencyKey` at definition level: template rendered at run start (e.g. "{{record.company_id}}"): at most one active run per key value, later runs wait their turn (creation order), nothing is dropped. condition and switch read the record (object, recordId, condition / field) or, in value mode, any run value: condition { left: "{{steps.x.output.y}}", op, right }, switch { value: "{{steps.x.output.y}}", cases: [{ id, label, op, value }] } (filter operators: eq, neq, gt, in, contains, is_empty…). Input variables: {{record.…}}, {{event.…}} ({{event.recordId}} = record linked to the triggering event), {{steps.<id>.output.…}}, {{now}}, {{today}}, {{run.id}}, {{run.test}} (true in a test run), {{workflow.id}} (an unknown variable is reported by workflows.validate); in loop.do: {{item}}, {{index}} and all run variables (fn.* and raw-input blocks allowed). Triggers: trigger.schedule { cron, object? (without object: a single run), filter?, timezone? (IANA) }; trigger.run_failed { workflow? }: error workflow started when a run fails ({{event.runId}}, {{event.workflowName}}, {{event.error}}). Sub-workflow: block workflow.run { workflow (id or name), recordId?, event?, wait (default true: waits, ok/error branches, output = last output) }, max depth 5. `pins` { stepId: { output, branch? } }: pinned outputs replayed by dry_run and test_step.',
      inputSchema: z.object({
        name: z.string().min(1),
        definition: definitionSchema,
      }),
    },
    (input) =>
      run(() =>
        linted(ctx, lintWorkflow(input.definition), () =>
          workflowsService.create(ctx, input),
        ),
      ),
  );
  server.registerTool(
    "workflows.update",
    {
      description:
        "Updates a workflow. A new definition creates a new version.",
      inputSchema: z.object({
        id: wfId,
        name: z.string().min(1).optional(),
        status: z.enum(["draft", "active", "paused"]).optional(),
        definition: definitionSchema.optional(),
      }),
    },
    ({ id, ...patch }) =>
      run(() =>
        linted(
          ctx,
          patch.definition ? lintWorkflow(patch.definition) : [],
          () => workflowsService.update(ctx, id, patch),
        ),
      ),
  );
  server.registerTool(
    "workflows.restore",
    {
      description:
        "Restores a previous version (creates a new version with its definition).",
      inputSchema: z.object({ id: wfId, version: z.number().int().min(1) }),
    },
    ({ id, version }) => run(() => workflowsService.restore(ctx, id, version)),
  );

  server.registerTool(
    "workflows.activate",
    {
      description:
        "Activates a workflow (refused if its definition is invalid): its triggers fire.",
      inputSchema: z.object({ id: wfId }),
    },
    ({ id }) => run(() => workflowsService.activate(ctx, id)),
  );
  server.registerTool(
    "workflows.deactivate",
    {
      description:
        "Pauses a workflow: its triggers no longer fire and its running runs are cancelled at their next step.",
      inputSchema: z.object({ id: wfId }),
    },
    ({ id }) => run(() => workflowsService.deactivate(ctx, id)),
  );
  server.registerTool(
    "workflows.delete",
    {
      description:
        "Deletes a workflow, its versions and its whole run history. Irreversible: confirm: true required (workflows.deactivate is enough to stop it).",
      inputSchema: z.object({ id: wfId, confirm: z.boolean().optional() }),
    },
    ({ id, confirm }) =>
      run(async () => {
        requireConfirm(
          confirm,
          "workflows.deleteConfirm",
          "Deleting the workflow and its runs",
        );
        return must(
          workflowsService.remove(ctx, id),
          "Workflow",
          id,
          "See workflows.list.",
        );
      }),
  );
}
