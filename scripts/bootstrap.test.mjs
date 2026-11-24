import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fillSecrets, newSecrets } from "./bootstrap.mjs";

test("bootstrap: fills empty secrets only", () => {
  const env = "A=1\nBETTER_AUTH_SECRET=\nSECRETS_MASTER_KEY=kept\n";
  assert.equal(
    fillSecrets(env, { BETTER_AUTH_SECRET: "x", SECRETS_MASTER_KEY: "y" }),
    "A=1\nBETTER_AUTH_SECRET=x\nSECRETS_MASTER_KEY=kept\n",
  );
});

test("bootstrap: secrets are 32 random bytes", () => {
  const a = newSecrets();
  assert.equal(Buffer.from(a.SECRETS_MASTER_KEY, "base64").length, 32);
  assert.notEqual(a.BETTER_AUTH_SECRET, newSecrets().BETTER_AUTH_SECRET);
});
