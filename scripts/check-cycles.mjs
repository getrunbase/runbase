// Fails when packages/core has an import cycle that is not in KNOWN.
// Type-only imports are ignored (.madgerc). Dynamic imports count: do not
// hide a cycle behind `await import(...)`, inject the dependency instead
// (see BlockEngine in packages/core/src/blocks/block.ts).
/* global console, process */
import madge from "madge";

// Pre-existing cycles between two services of the same layer. Remove an
// entry once its cycle is broken; never add one to make the check pass.
const KNOWN = new Set([
  "api-keys/index.ts > audit/index.ts",
  "bus/index.ts > queues/fair.ts",
  "bus/index.ts > queues/fair.ts > quotas/index.ts",
  "objects/index.ts > databases/index.ts",
  "functions/sandbox.ts > functions/sandbox-client.ts",
  "workflows/index.ts > workflows/validate.ts",
]);

const res = await madge("packages/core/src", {
  fileExtensions: ["ts", "tsx"],
  tsConfig: "packages/core/tsconfig.json",
  detectiveOptions: {
    ts: { skipTypeImports: true },
    tsx: { skipTypeImports: true },
  },
});
const cycles = res.circular().map((c) => c.join(" > "));
const unknown = cycles.filter((c) => !KNOWN.has(c));
const fixed = [...KNOWN].filter((c) => !cycles.includes(c));
for (const c of unknown) console.error(`New import cycle: ${c}`);
for (const c of fixed)
  console.error(
    `Cycle gone, remove it from KNOWN in ${import.meta.filename}: ${c}`,
  );
if (unknown.length || fixed.length) process.exit(1);
