// CLI: init generates a skeleton that passes test; registry; sandbox bundle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type Io } from "./cli";
import { bundleConnector, readConnector } from "./build";

function capture(): Io & { out: string[] } {
  const out: string[] = [];
  return { out, log: (s) => out.push(s), error: (s) => out.push(s) };
}

test("init then test: the skeleton passes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "node-cli-"));
  try {
    const io = capture();
    assert.equal(await main(["node", "init", "acme", "--dir", dir], io), 0);
    const pkg = JSON.parse(
      await readFile(join(dir, "acme/package.json"), "utf8"),
    );
    assert.equal(pkg.name, "@runbase-connectors/acme");
    assert.equal(pkg.license, "MIT");
    assert.equal(
      await main(["node", "test", join(dir, "acme")], io),
      0,
      io.out.join("\n"),
    );
    assert.ok(io.out.some((l) => l.includes("acme.hello: example 1")));
    // Name already taken, invalid name.
    assert.equal(await main(["node", "init", "acme", "--dir", dir], io), 1);
    assert.equal(await main(["node", "init", "Bad_Name", "--dir", dir], io), 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("test: wrong example or forbidden Node import = failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "node-cli-"));
  try {
    const io = capture();
    await main(["node", "init", "bad", "--dir", dir], io);
    const entry = join(dir, "bad/index.ts");
    const src = await readFile(entry, "utf8");
    await writeFile(entry, src.replace('"Hello Ada"', '"Bye"'));
    assert.equal(await main(["node", "test", join(dir, "bad")], io), 1);
    assert.ok(io.out.some((l) => l.includes("FAIL bad.hello: example 1")));
    await writeFile(entry, `import "node:fs";\n${src}`);
    assert.equal(await main(["node", "test", join(dir, "bad")], io), 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("registry: writes then checks registry.json", async () => {
  const dir = await mkdtemp(join(tmpdir(), "node-cli-"));
  try {
    const io = capture();
    await main(["node", "init", "one", "--dir", dir], io);
    assert.equal(await main(["node", "registry", dir, "--check"], io), 1);
    assert.equal(await main(["node", "registry", dir], io), 0);
    assert.equal(await main(["node", "registry", dir, "--check"], io), 0);
    const reg = JSON.parse(await readFile(join(dir, "registry.json"), "utf8"));
    assert.equal(reg.connectors[0].name, "@runbase-connectors/one");
    assert.equal(reg.connectors[0].path, "one");
    assert.equal(reg.connectors[0].nodes[0].id, "one.hello");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("repository connectors/registry.json is up to date", async () => {
  const io = capture();
  const repo = new URL("../../../connectors", import.meta.url).pathname;
  assert.equal(
    await main(["node", "registry", repo, "--check"], io),
    0,
    io.out.join("\n"),
  );
});

test("bundle: self-contained module without imports", async () => {
  const dir = await mkdtemp(join(tmpdir(), "node-cli-"));
  try {
    await main(["node", "init", "solo", "--dir", dir], capture());
    const code = await bundleConnector(
      (await readConnector(join(dir, "solo")))!,
    );
    assert.doesNotMatch(code, /^\s*import\s/m);
    assert.match(code, /export\s*\{[^}]*default/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("publish: refuses a package outside the @runbase-connectors scope", async () => {
  const dir = await mkdtemp(join(tmpdir(), "node-cli-"));
  try {
    const io = capture();
    await main(["node", "init", "pub", "--dir", dir], io);
    const p = join(dir, "pub/package.json");
    const pkg = JSON.parse(await readFile(p, "utf8"));
    await writeFile(p, JSON.stringify({ ...pkg, name: "pub" }));
    assert.equal(await main(["node", "publish", join(dir, "pub")], io), 1);
    assert.ok(io.out.some((l) => l.includes("must be named")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
