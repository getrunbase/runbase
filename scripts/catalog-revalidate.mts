// Catalog publishing: after a merge on main, sends the site
// (runbase-cloud, ISR receiver) the signed webhook listing the pages to
// revalidate (templates, authors, connectors changed by the diff).
// Env: CATALOG_REVALIDATE_URL, CATALOG_REVALIDATE_SECRET (sent as
// Bearer); if missing, nothing is sent, exit 0.
// Usage: node --import tsx scripts/catalog-revalidate.mts <sha before> <sha after>
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "../packages/core/src/catalog/load";
import {
  revalidationPaths,
  sendRevalidation,
} from "../packages/core/src/catalog/publish";

const root = fileURLToPath(new URL("..", import.meta.url));
const [before, after = "HEAD"] = process.argv.slice(2);
const url = process.env.CATALOG_REVALIDATE_URL;
const secret = process.env.CATALOG_REVALIDATE_SECRET;
if (!url || !secret) {
  console.log(
    "catalog-revalidate: CATALOG_REVALIDATE_URL/SECRET not set, skipped",
  );
  process.exit(0);
}
// Before sha missing or null (first push): diff of the last commit only.
const range =
  before && !/^0+$/.test(before) ? [before, after] : [`${after}~1`, after];
const changed = execFileSync(
  "git",
  ["diff", "--name-only", ...range, "--", "templates", "authors", "connectors"],
  { cwd: root, encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean);
const paths = revalidationPaths(changed, await loadCatalog(root));
if (!paths.length) {
  console.log("catalog-revalidate: no catalog page changed");
  process.exit(0);
}
await sendRevalidation(paths, { url, secret });
console.log(
  `catalog-revalidate: ${paths.length} page(s) sent: ${paths.join(", ")}`,
);
