// UI / MCP parity test: every method of the service registry
// of @runbase/core must have its MCP tool registered. No database.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { McpServer } from "@modelcontextprotocol/server";
import type { McpPrincipal } from "@runbase/core/tenant";
import { services, mcpTools } from "@runbase/core/services";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { registerTools, withMcpRequest } from "./tools";

// Importing bus/db opens connections (Redis) that keep the process alive.
after(() => setImmediate(() => process.exit(0)));

test("every service has an MCP tool", () => {
  const registered = new Set<string>();
  const server = {
    registerTool: (name: string) => registered.add(name),
  } as unknown as McpServer;
  withMcpRequest({ principal: {} as McpPrincipal }, () =>
    registerTools(server),
  );

  const missing: string[] = [];
  for (const [name, service] of Object.entries(services)) {
    const tools = mcpTools[name as keyof typeof mcpTools] as Record<
      string,
      string | null | undefined
    >;
    for (const method of Object.keys(service)) {
      const tool = tools[method];
      if (tool === null) continue;
      if (!tool || !registered.has(tool))
        missing.push(`${name}.${method} -> ${tool ?? "aucun outil"}`);
    }
  }
  assert.deepEqual(missing, []);
});

// Completeness: every `*Service` export of the @runbase/core entry points
// must be listed in the `services` registry.
test("every *Service exported by core is in the registry", async () => {
  const pkg = JSON.parse(
    readFileSync(
      join(dirname(require.resolve("@runbase/core")), "../package.json"),
      "utf8",
    ),
  ) as { exports: Record<string, string> };
  // Compared by name (`records` <-> `recordsService`): the dynamic import
  // may load another instance of the module than the static import.
  const registered = new Set(Object.keys(services).map((k) => `${k}Service`));
  const missing: string[] = [];
  for (const entry of Object.keys(pkg.exports)) {
    const mod = (await import(
      entry === "." ? "@runbase/core" : `@runbase/core/${entry.slice(2)}`
    )) as Record<string, unknown>;
    for (const name of Object.keys(mod))
      if (name.endsWith("Service") && !registered.has(name))
        missing.push(`${entry} : ${name}`);
  }
  assert.deepEqual([...new Set(missing)], []);
});
