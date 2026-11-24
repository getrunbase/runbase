// `runbase node init|dev|test|publish|registry` CLI: lifecycle of a
// connector (skeleton, dev loop, tests, npm publishing, registry).
import { spawnSync } from "node:child_process";
import { watch } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  SCOPE,
  buildRegistry,
  bundleConnector,
  loadNodes,
  readConnector,
  type ConnectorInfo,
} from "./build.ts";

export type Io = { log: (s: string) => void; error: (s: string) => void };
const consoleIo: Io = { log: console.log, error: console.error };

const USAGE = `Usage: runbase node <command>
  init <name> [--dir <dir>]      create a connector skeleton in <dir>/<name>
  test [path]                    validate nodes, run examples, check the sandbox bundle
  dev [path]                     run test on every change
  publish [path] [--dry-run]     test then publish to npm (${SCOPE}<name>)
  registry [dir] [--check]       write <dir>/registry.json (default: ./connectors)`;

const NAME = /^[a-z][a-z0-9-]*$/;

function flag(args: string[], name: string): string | true | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, v && !v.startsWith("--") ? 2 : 1);
  return v && !v.startsWith("--") ? v : true;
}

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

export async function init(name: string, base: string): Promise<string> {
  if (!NAME.test(name))
    throw new Error(`invalid name "${name}" (lowercase letters, digits, -)`);
  const dir = join(base, name);
  if (await exists(dir)) throw new Error(`${dir} already exists`);
  await mkdir(dir, { recursive: true });
  const id = name.replace(/-/g, "_");
  const pkg = {
    name: `${SCOPE}${name}`,
    version: "0.1.0",
    description: `${name} connector for Runbase.`,
    license: "MIT",
    type: "module",
    runbase: { entry: "index.ts", label: name },
    dependencies: { "@runbase/node-sdk": "*", zod: "^4.6.7" },
  };
  const files: Record<string, string> = {
    "package.json": JSON.stringify(pkg, null, 2) + "\n",
    "index.ts": `import { z } from "zod";
import { defineNode } from "@runbase/node-sdk";

export default defineNode({
  id: "${id}.hello",
  label: "Say hello",
  description: "Returns a greeting.",
  inputs: z.object({ name: z.string().min(1) }),
  outputs: z.object({ message: z.string() }),
  // Secrets and network domains the node needs:
  // auth: { secrets: ["API_KEY"], domains: ["api.example.com"] },
  examples: [{ input: { name: "Ada" }, output: { message: "Hello Ada" } }],
  run: async ({ name }) => ({ message: \`Hello \${name}\` }),
});
`,
    "README.md": `# ${pkg.name}\n\nRun \`runbase node test\` to validate, \`runbase node publish\` to release.\n`,
  };
  for (const [f, content] of Object.entries(files))
    await writeFile(join(dir, f), content);
  return dir;
}

async function connectorAt(path: string): Promise<ConnectorInfo> {
  const c = await readConnector(resolve(path));
  if (!c)
    throw new Error(
      `${resolve(path)}: no package.json with a "runbase" field`,
    );
  return c;
}

// Validates the nodes, plays the examples, checks the sandbox bundle.
export async function testConnector(
  path: string,
  io: Io = consoleIo,
): Promise<boolean> {
  const c = await connectorAt(path);
  let ok = true;
  const fail = (m: string) => ((ok = false), io.error(`  FAIL ${m}`));
  const nodes = await loadNodes(c);
  for (const n of nodes) {
    try {
      const m = n.manifest();
      JSON.stringify(m);
      io.log(`  ok   ${m.id}: manifest`);
    } catch (e) {
      fail(`${n.id}: manifest: ${(e as Error).message}`);
      continue;
    }
    for (const [i, ex] of (n.examples ?? []).entries()) {
      try {
        const { output } = await n.execute(ex.input, { secrets: ex.secrets });
        if (ex.output !== undefined && !isDeepStrictEqual(output, ex.output))
          fail(
            `${n.id}: example ${i + 1}: expected ${JSON.stringify(ex.output)}, got ${JSON.stringify(output)}`,
          );
        else io.log(`  ok   ${n.id}: example ${i + 1}`);
      } catch (e) {
        fail(`${n.id}: example ${i + 1}: ${(e as Error).message}`);
      }
    }
  }
  try {
    const code = await bundleConnector(c);
    io.log(`  ok   sandbox bundle (${code.length} bytes)`);
  } catch (e) {
    fail(`sandbox bundle: ${(e as Error).message}`);
  }
  io.log(ok ? `${c.name}: passed` : `${c.name}: failed`);
  return ok;
}

export async function publish(
  path: string,
  dryRun: boolean,
  io: Io = consoleIo,
): Promise<boolean> {
  const c = await connectorAt(path);
  if (!c.name.startsWith(SCOPE))
    throw new Error(
      `${c.name}: connector packages must be named ${SCOPE}<name>`,
    );
  const pkg = JSON.parse(await readFile(join(c.dir, "package.json"), "utf8"));
  if (pkg.license !== "MIT") io.error(`  warn ${c.name}: license is not MIT`);
  if (!(await testConnector(path, io))) return false;
  const args = dryRun
    ? ["pack", "--dry-run"]
    : ["publish", "--access", "public"];
  const r = spawnSync("npm", args, { cwd: c.dir, stdio: "inherit" });
  return r.status === 0;
}

export async function registry(
  dir: string,
  check: boolean,
  io: Io = consoleIo,
): Promise<boolean> {
  const file = join(dir, "registry.json");
  const json = JSON.stringify(await buildRegistry(dir), null, 2) + "\n";
  if (check) {
    const cur = await readFile(file, "utf8").catch(() => "");
    if (cur !== json) {
      io.error(`${file} is out of date: run runbase node registry ${dir}`);
      return false;
    }
    io.log(`${file} is up to date`);
    return true;
  }
  await writeFile(file, json);
  io.log(`wrote ${file}`);
  return true;
}

export async function main(
  argv: string[],
  io: Io = consoleIo,
): Promise<number> {
  const args = [...argv];
  if (args[0] === "node") args.shift();
  const cmd = args.shift();
  try {
    switch (cmd) {
      case "init": {
        const d = flag(args, "--dir");
        const base =
          typeof d === "string"
            ? d
            : (await exists("connectors"))
              ? "connectors"
              : ".";
        if (!args[0]) throw new Error("missing <name>");
        io.log(`created ${await init(args[0], resolve(base))}`);
        return 0;
      }
      case "test":
        return (await testConnector(args[0] ?? ".", io)) ? 0 : 1;
      case "dev": {
        const path = resolve(args[0] ?? ".");
        await testConnector(path, io).catch((e) => io.error(String(e)));
        let timer: NodeJS.Timeout | undefined;
        watch(path, { recursive: true }, (_e, f) => {
          if (!f || f.includes("node_modules")) return;
          clearTimeout(timer);
          timer = setTimeout(() => {
            io.log(`\n${basename(String(f))} changed`);
            testConnector(path, io).catch((e) => io.error(String(e)));
          }, 100);
        });
        io.log(`watching ${path}`);
        return await new Promise<number>(() => {});
      }
      case "publish": {
        const dry = flag(args, "--dry-run") === true;
        return (await publish(args[0] ?? ".", dry, io)) ? 0 : 1;
      }
      case "registry": {
        const check = flag(args, "--check") === true;
        return (await registry(resolve(args[0] ?? "connectors"), check, io))
          ? 0
          : 1;
      }
      default:
        io.log(USAGE);
        return cmd ? 1 : 0;
    }
  } catch (e) {
    io.error(`error: ${(e as Error).message}`);
    return 1;
  }
}
