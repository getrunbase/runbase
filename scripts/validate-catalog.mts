// Catalog CI check: validates connectors/, templates/ and authors/
// (existing author profile, description >= 300 words with its sections, valid
// manifest). Exit code 1 and one English message per issue.
// `--out <file>` also writes the JSON index read by the public API
// (CATALOG_INDEX variable), to generate at build time.
// Usage: pnpm catalog:validate [--out index.json] [repository root]
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "../packages/core/src/catalog/load";

const args = process.argv.slice(2);
const o = args.indexOf("--out");
const out = o >= 0 ? resolve(args.splice(o, 2)[1]!) : undefined;
const root = resolve(args[0] ?? fileURLToPath(new URL("..", import.meta.url)));
const { issues, ...catalog } = await loadCatalog(root);
for (const i of issues) console.error(`error: ${i.message}`);
console.log(
  `catalog: ${catalog.connectors.length} connector(s), ${catalog.templates.length} template(s), ${catalog.authors.length} author(s), ${issues.length} problem(s)`,
);
if (out && !issues.length) await writeFile(out, JSON.stringify(catalog));
process.exit(issues.length ? 1 : 0);
