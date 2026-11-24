#!/usr/bin/env node
// Checks the license layout of the repository (see README, Licensing section):
// - root LICENSE = FSL-1.1-ALv2;
// - every workspace package.json has a "license" field consistent with its folder;
// - every connectors/* or templates/* folder contains an MIT LICENSE.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { argv, cwd, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

export const FSL = "FSL-1.1-ALv2";
export const MIT = "MIT";

// Folders whose content is MIT (SDK, kit, ui, connectors, templates).
const MIT_DIRS =
  /^(packages\/(sdk|node-sdk|kit|ui)|connectors\/[^/]+|templates\/[^/]+)$/;

/** Expected license for a folder relative to the root ("" = root). */
export function expectedLicense(dir) {
  if (MIT_DIRS.test(dir)) return MIT;
  return FSL;
}

const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);

/** "folder/*" or "folder" globs from pnpm-workspace.yaml (simple format). */
export function workspaceGlobs(root) {
  const yaml = read(join(root, "pnpm-workspace.yaml")) ?? "";
  const globs = [];
  let inPackages = false;
  for (const line of yaml.split("\n")) {
    if (/^\S/.test(line)) inPackages = /^packages:\s*$/.test(line);
    const m = inPackages && line.match(/^\s+-\s+["']?([^"'#\s]+)["']?/);
    if (m) globs.push(m[1]);
  }
  return globs;
}

function expand(root, glob) {
  if (!glob.endsWith("/*")) return isDir(join(root, glob)) ? [glob] : [];
  const base = glob.slice(0, -2);
  if (!isDir(join(root, base))) return [];
  return readdirSync(join(root, base))
    .map((name) => `${base}/${name}`)
    .filter((d) => isDir(join(root, d)));
}

/** Returns the list of errors (empty = compliant). */
export function checkLicenses(root) {
  const errors = [];

  const rootLicense = read(join(root, "LICENSE"));
  if (!rootLicense?.includes("Functional Source License, Version 1.1, ALv2")) {
    errors.push("LICENSE: missing or not the FSL-1.1-ALv2 text");
  } else if (/\$\{(year|licensor name)\}/.test(rootLicense)) {
    errors.push("LICENSE: unfilled ${year} / ${licensor name} placeholder");
  }

  const dirs = new Set([""]);
  for (const g of workspaceGlobs(root))
    for (const d of expand(root, g)) dirs.add(d);
  for (const base of ["connectors", "templates"]) {
    for (const d of expand(root, `${base}/*`)) dirs.add(d);
  }

  for (const dir of [...dirs].sort()) {
    const label = dir || ".";
    const expected = expectedLicense(dir);
    const pkgRaw = read(join(root, dir, "package.json"));
    if (pkgRaw !== null) {
      let license;
      try {
        license = JSON.parse(pkgRaw).license;
      } catch {
        errors.push(`${label}/package.json: invalid JSON`);
        continue;
      }
      if (!license)
        errors.push(
          `${label}/package.json: "license" missing (expected "${expected}")`,
        );
      else if (license !== expected) {
        errors.push(
          `${label}/package.json: "license" is "${license}", expected "${expected}"`,
        );
      }
    }
    if (expected === MIT) {
      const text = read(join(root, dir, "LICENSE"));
      if (!text) errors.push(`${label}/LICENSE: missing (MIT required)`);
      else if (!/^\s*MIT License/.test(text))
        errors.push(`${label}/LICENSE: not an MIT license`);
    }
  }
  return errors;
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(fileURLToPath(import.meta.url), "../..");
  const errors = checkLicenses(root);
  for (const e of errors) stderr.write(`✗ ${e}\n`);
  if (errors.length) exit(1);
  stdout.write(`Licenses OK (${relative(cwd(), root) || "."})\n`);
}
