// MCP tools: secrets, signed incoming webhooks and SQL queries.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { TenantContext } from "@getrunbase/core/tenant";
import { webhooksService } from "@getrunbase/core/webhooks";
import { secretsService } from "@getrunbase/core/secrets";
import { connectionsService } from "@getrunbase/core/connections";
import { queryService } from "@getrunbase/core/query";
import { run, must } from "./shared";

export function defineIntegrationTools(server: McpServer, ctx: TenantContext) {
  // Webhook reference: id or name (agents often pass the name).
  const hook = async (ref: string) =>
    (await webhooksService.list(ctx)).find(
      (w) => w.id === ref || w.name === ref,
    )?.id ?? ref;
  // Secrets: write-only values, never read back.
  const secretName = z
    .string()
    .describe("Secret name, referenced by {{secret.NAME}}");
  server.registerTool(
    "secrets.list",
    {
      description: "Lists the workspace secret names (never the values).",
    },
    () => run(() => secretsService.list(ctx)),
  );
  // OAuth connections: accounts used by connector nodes, never the tokens.
  server.registerTool(
    "connections.list",
    {
      description:
        "Lists the workspace OAuth connections (provider, name, account email). Pass the name as the `connection` input of a connector node when the workspace has several accounts for its provider. The user connects new accounts from the workflow editor or Settings › Connections.",
    },
    () => run(() => connectionsService.list(ctx)),
  );
  server.registerTool(
    "connections.providers",
    {
      description:
        "Lists the OAuth providers of the installed connectors: scopes, node types and whether an OAuth client is configured.",
    },
    () => run(() => connectionsService.providers(ctx)),
  );
  server.registerTool(
    "connections.delete",
    {
      description:
        "Disconnects an OAuth account (id from connections.list) and revokes it at the provider. Workflows using it fail until it is reconnected.",
      inputSchema: z.object({ id: z.string().describe("Webhook id or name") }),
    },
    ({ id }) => run(() => connectionsService.remove(ctx, id)),
  );
  // Signed incoming webhooks
  server.registerTool(
    "webhooks.create",
    {
      description:
        "Creates a public endpoint POST /api/hooks/<id> (`path`): signature verified with the secret `secretName` (secrets.set), then event `eventType` pushed (workflow trigger), deduplicated by the external id (`config.idPath`, default `id`). `config.dedupe`: `id` (default: a resend of the same id is dropped, response duplicate: true, no workflow), `id+hash` (dropped only if the item content is identical: an enriched resend of the same id creates a new event and starts the workflow), `none` (every call creates an event). Unique name per workspace. Formats: `stripe`, `standard` (Standard Webhooks/Svix, id = webhook-id header), `hmac` (header, algorithm sha256|sha1|sha512, encoding hex|base64, prefix e.g. `sha256=`, timestampHeader + template `{timestamp}.{body}`, idHeader; headerFormat `kv` reads a `t=<unix>,v1=<sig>[,v1=…]` header value with timestampKey (default `t`) and signatureKey (default `v1`, any listed signature matches), signedPayload default `{t}.{body}`, toleranceSec default 300; secretEncoding raw (default) | base64 | whsec (`whsec_<base64>` decoded)). `stripe` = hmac kv on `stripe-signature`. Outreach-like: { format: 'hmac', header: 'X-Outreach-Signature', headerFormat: 'kv', signedPayload: '{t}.{body}' }. Cal.com: hmac header `x-cal-signature-256`. Batches: `config.splitPath` (e.g. `events`) or a root array give one event per item, `idPath` relative to the item. `config.storeSample: false`: no sample stored. Test URL `testPath` (/api/hooks/<id>/test): signature verified and sample saved, no event or workflow started (to listen to a provider's next call and write the mapping). Bodies: JSON or application/x-www-form-urlencoded (form fields, repeated keys as arrays). Every call must be HMAC-signed: a plain HTML form cannot sign, so put a signing proxy (edge function, form service) in front of it. Mapped values are validated at reception (unknown field, invalid email, unknown select option): with `config.rejectUnmapped` the call gets 422 with `invalid` [{field, value, problem}] (or `missing` for an unresolved match field), otherwise the problems are listed in the response `warnings`. While a run is active on the record, deliveries coalesce into one follow-up (older ones marked superseded, warning in errors.list); trigger `queue: 'each'` runs every delivery.",
      inputSchema: z.object({
        name: z.string().min(1),
        eventType: z.string().min(1),
        secretName: z.string().min(1),
        config: z.record(z.string(), z.unknown()),
      }),
    },
    (input) => run(() => webhooksService.create(ctx, input as never)),
  );
  server.registerTool(
    "webhooks.update",
    {
      description:
        "Updates an inbound webhook (name, eventType, secretName, full config) without changing its URL.",
      inputSchema: z.object({
        id: z.string().describe("Webhook id or name"),
        name: z.string().min(1).optional(),
        eventType: z.string().min(1).optional(),
        secretName: z.string().min(1).optional(),
        config: z.record(z.string(), z.unknown()).optional(),
      }),
    },
    ({ id, ...patch }) =>
      run(async () =>
        webhooksService.update(ctx, await hook(id), patch as never),
      ),
  );
  server.registerTool(
    "webhooks.clear_sample",
    {
      description:
        "Clears the last saved payload (sample) of an inbound webhook.",
      inputSchema: z.object({ id: z.string().describe("Webhook id or name") }),
    },
    ({ id }) =>
      run(async () => webhooksService.clearSample(ctx, await hook(id))),
  );
  server.registerTool(
    "webhooks.test",
    {
      description:
        "Sends a test payload signed with the webhook secret, in test mode: checks secret and configuration, saves the payload as sample, pushes no event and starts no workflow.",
      inputSchema: z.object({
        id: z.string().describe("Webhook id or name"),
        payload: z.unknown().describe("JSON sent, e.g. { id: 'evt_1' }"),
      }),
    },
    ({ id, payload }) =>
      run(async () =>
        webhooksService.sendTest(ctx, await hook(id), payload ?? {}),
      ),
  );
  server.registerTool(
    "webhooks.list",
    {
      description:
        "Lists the workspace inbound webhooks: `path` (production), `testPath` (test, starts nothing), last received payload (`sample`, `sampleAt`).",
      inputSchema: z.object({}),
    },
    () => run(() => webhooksService.list(ctx)),
  );
  server.registerTool(
    "webhooks.delete",
    {
      description: "Deletes an inbound webhook (the URL stops responding).",
      inputSchema: z.object({ id: z.string().describe("Webhook id or name") }),
    },
    ({ id }) =>
      run(async () =>
        must(
          webhooksService.remove(ctx, await hook(id)),
          "Webhook",
          id,
          "See webhooks.list.",
        ),
      ),
  );
  server.registerTool(
    "secrets.set",
    {
      description:
        "Creates or replaces a secret (encrypted). The value can never be read back.",
      inputSchema: z.object({ name: secretName, value: z.string().min(1) }),
    },
    ({ name, value }) => run(() => secretsService.set(ctx, name, value)),
  );
  server.registerTool(
    "secrets.delete",
    {
      description: "Deletes a secret.",
      inputSchema: z.object({ name: secretName }),
    },
    ({ name }) => run(() => secretsService.remove(ctx, name)),
  );

  // SQL queries: read-only, isolated connection role.
  const queryName = z.string().describe("Saved query name");
  server.registerTool(
    "query.sql",
    {
      description:
        "Runs a read-only SQL query on the workspace views. Returns { rows, truncated }: beyond 1000 rows, truncated = true and only the first 1000 are returned (add LIMIT/OFFSET or aggregate).",
      inputSchema: z.object({ sql: z.string().min(1) }),
    },
    ({ sql }) => run(() => queryService.sql(ctx, sql)),
  );
  server.registerTool(
    "query.saved",
    { description: "Lists the workspace saved queries." },
    () => run(() => queryService.saved(ctx)),
  );
  server.registerTool(
    "query.save",
    {
      description: "Creates or replaces a named saved query.",
      inputSchema: z.object({ name: queryName, sql: z.string().min(1) }),
    },
    ({ name, sql }) => run(() => queryService.save(ctx, name, sql)),
  );
  server.registerTool(
    "query.delete",
    {
      description: "Deletes a saved query.",
      inputSchema: z.object({ name: queryName }),
    },
    ({ name }) => run(() => queryService.remove(ctx, name)),
  );
}
