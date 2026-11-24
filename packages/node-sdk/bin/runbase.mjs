#!/usr/bin/env node
// `runbase` CLI: code compiled into dist/ once published (sources in src/ in the
// monorepo); tsx loads the user's TypeScript connectors.
import { existsSync } from "node:fs";
import process from "node:process";
import { URL } from "node:url";
import { register } from "tsx/esm/api";

register();
const dist = new URL("../dist/cli.js", import.meta.url);
const { main } = await import(
  existsSync(dist) ? dist.href : "../src/cli.ts"
);
process.exitCode = await main(process.argv.slice(2));
