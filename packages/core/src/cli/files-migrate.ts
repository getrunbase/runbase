// pnpm files:migrate [--dry-run]: copies files from disk (FILES_DIR,
// default .data/files) to the S3/R2 bucket described by S3_*. Idempotent.
// Run before switching to FILES_DRIVER=s3 in production, then a second
// time right after the switch to catch the last uploads.
import { join } from "node:path";
import { migrateLocalFiles } from "../files/migrate";
import { storageFromEnv } from "../files/storage";

const dryRun = process.argv.includes("--dry-run");
const root = process.env.FILES_DIR ?? join(process.cwd(), ".data/files");
const dest = storageFromEnv({ ...process.env, FILES_DRIVER: "s3" });
const r = await migrateLocalFiles(root, dest, { dryRun, log: console.log });
console.log(
  `${dryRun ? "Dry run: " : ""}${r.copied} file(s) copied, ${r.skipped} already in the bucket`,
);
process.exit(0);
