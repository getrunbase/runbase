import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { checkLicenses, expectedLicense } from "./check-licenses.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = [];
after(() => tmp.forEach((d) => rmSync(d, { recursive: true, force: true })));

// Builds a compliant mini repository, editable per test.
function fixture(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "licenses-"));
  tmp.push(root);
  const base = {
    "pnpm-workspace.yaml":
      "packages:\n  - apps/*\n  - packages/*\nallowBuilds:\n  x: true\n",
    LICENSE:
      "# Functional Source License, Version 1.1, ALv2 Future License\nCopyright 2026 Runbase\n",
    "package.json": { name: "root", license: "FSL-1.1-ALv2" },
    "apps/web/package.json": { name: "web", license: "FSL-1.1-ALv2" },
    "packages/core/package.json": { name: "core", license: "FSL-1.1-ALv2" },
  };
  for (const [path, content] of Object.entries({ ...base, ...files })) {
    if (content === null) continue;
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(
      join(root, path),
      typeof content === "string" ? content : JSON.stringify(content),
    );
  }
  return root;
}

describe("check-licenses", () => {
  it("the real repository is compliant", () => {
    assert.deepEqual(checkLicenses(repoRoot), []);
  });

  it("maps directories to the expected license", () => {
    assert.equal(expectedLicense(""), "FSL-1.1-ALv2");
    assert.equal(expectedLicense("apps/worker"), "FSL-1.1-ALv2");
    assert.equal(expectedLicense("packages/sdk"), "MIT");
    assert.equal(expectedLicense("packages/kit"), "MIT");
    assert.equal(expectedLicense("packages/node-sdk"), "MIT");
    assert.equal(expectedLicense("connectors/slack"), "MIT");
    assert.equal(expectedLicense("templates/crm"), "MIT");
  });

  it("accepts a compliant fixture", () => {
    assert.deepEqual(checkLicenses(fixture()), []);
  });

  it("fails when a workspace package has no license", () => {
    const errors = checkLicenses(
      fixture({ "apps/web/package.json": { name: "web" } }),
    );
    assert.deepEqual(errors, [
      'apps/web/package.json: "license" missing (expected "FSL-1.1-ALv2")',
    ]);
  });

  it("fails on an inconsistent license", () => {
    const errors = checkLicenses(
      fixture({ "packages/core/package.json": { license: "MIT" } }),
    );
    assert.match(
      errors.join(),
      /packages\/core\/package.json: "license" is "MIT"/,
    );
  });

  it("requires MIT for sdk with its LICENSE file", () => {
    const errors = checkLicenses(
      fixture({ "packages/sdk/package.json": { license: "FSL-1.1-ALv2" } }),
    );
    assert.equal(errors.length, 2);
    assert.match(errors[0], /expected "MIT"/);
    assert.match(errors[1], /packages\/sdk\/LICENSE: missing/);
  });

  it("requires an MIT LICENSE in every connectors/* and templates/* folder", () => {
    const errors = checkLicenses(
      fixture({
        "connectors/slack/index.ts": "",
        "templates/crm/LICENSE": "Apache License\n",
        "templates/ok/LICENSE": "MIT License\n\nCopyright 2026 Runbase\n",
      }),
    );
    assert.deepEqual(errors, [
      "connectors/slack/LICENSE: missing (MIT required)",
      "templates/crm/LICENSE: not an MIT license",
    ]);
  });

  it("checks the root license file", () => {
    const errors = checkLicenses(fixture({ LICENSE: "MIT License\n" }));
    assert.deepEqual(errors, ["LICENSE: missing or not the FSL-1.1-ALv2 text"]);
  });

  it("rejects unfilled placeholders", () => {
    const errors = checkLicenses(
      fixture({
        LICENSE:
          "Functional Source License, Version 1.1, ALv2\nCopyright ${year} ${licensor name}\n",
      }),
    );
    assert.deepEqual(errors, [
      "LICENSE: unfilled ${year} / ${licensor name} placeholder",
    ]);
  });
});
