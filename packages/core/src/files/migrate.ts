// Copies files from disk (local driver, FILES_DIR) to another
// storage (S3/R2 bucket). Idempotent: an already present key is skipped,
// it can be rerun after an interruption. The disk is never modified.
import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { localStorage, type FileStorage } from "./storage";

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && !e.name.endsWith(".type")) yield p;
  }
}

export type MigrateReport = { copied: number; skipped: number; keys: string[] };

export async function migrateLocalFiles(
  root: string,
  dest: FileStorage,
  opts: { dryRun?: boolean; log?: (line: string) => void } = {},
): Promise<MigrateReport> {
  const src = localStorage(root);
  const report: MigrateReport = { copied: 0, skipped: 0, keys: [] };
  for await (const path of walk(root)) {
    const key = relative(root, path).split(sep).join("/");
    if (await dest.head(key)) {
      report.skipped++;
      continue;
    }
    const file = await src.get(key);
    if (!file) continue; // file without `.type`: never uploaded by the service
    if (!opts.dryRun) await dest.put(key, file);
    report.copied++;
    report.keys.push(key);
    opts.log?.(`${opts.dryRun ? "would copy" : "copied"} ${key}`);
  }
  return report;
}
