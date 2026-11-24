#!/usr/bin/env node
// First run for local development: checks the tools, writes .env with fresh
// secrets, starts the dependencies (docker-compose.yml), applies the
// migrations and creates the first admin account.
//   pnpm bootstrap [admin-email]
// Self-hosting in production uses ./setup.sh instead.
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import console from "node:console";
import process from "node:process";

const root = join(import.meta.dirname, "..");

// Replaces `KEY=` lines that are empty; other values are kept.
export function fillSecrets(envText, secrets) {
  let out = envText;
  for (const [k, v] of Object.entries(secrets))
    out = out.replace(new RegExp(`^${k}=$`, "m"), `${k}=${v}`);
  return out;
}

export const newSecrets = () => ({
  BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
  SECRETS_MASTER_KEY: randomBytes(32).toString("base64"),
});

const has = (cmd, args = ["--version"]) =>
  spawnSync(cmd, args, { stdio: "ignore" }).status === 0;

function run(cmd, args) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { cwd: root, stdio: "inherit" });
}

function main() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22)
    throw new Error(`Node >= 22 required (found ${process.version}).`);
  if (!has("docker", ["compose", "version"]))
    throw new Error("Docker with the compose plugin is required.");
  if (!has("deno"))
    console.warn("Deno not found: sandboxed functions will not run locally.");

  const envPath = join(root, ".env");
  if (existsSync(envPath)) console.log(".env exists: kept as is.");
  else {
    const text = fillSecrets(
      readFileSync(join(root, ".env.example"), "utf8"),
      newSecrets(),
    );
    writeFileSync(envPath, text, { mode: 0o600 });
    console.log(".env written with fresh secrets. Back up SECRETS_MASTER_KEY.");
  }

  if (!existsSync(join(root, "node_modules"))) run("pnpm", ["install"]);
  run("docker", ["compose", "up", "-d", "--wait"]);
  run("pnpm", ["db:migrate"]);
  const email = process.argv[2];
  if (email) run("pnpm", ["admin:create", email]);
  else console.log("\nCreate an admin with: pnpm admin:create you@example.com");
  console.log("\nReady. Start the app with: pnpm dev");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
