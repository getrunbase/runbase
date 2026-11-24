// Validation of permissions.domains domains: no DB or Deno.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../errors/app-error";
import { netFlags } from "./sandbox";
import { functionInputSchema } from "./index";

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof AppError ? e.code : String(e);
  }
  return null;
};

test("netFlags: *, host, host:port", () => {
  process.env.FUNCTIONS_ALLOW_PRIVATE_NETWORK = "1";
  try {
    assert.deepEqual(netFlags([]), []);
    assert.deepEqual(netFlags(["*"]), ["--allow-net"]);
    assert.deepEqual(netFlags(["a.com"]), ["--allow-net=a.com"]);
    assert.deepEqual(netFlags(["[fd00::1]:443"]), [
      "--allow-net=[fd00::1]:443",
    ]);
    assert.deepEqual(netFlags(["a.com:8080", "b.io"]), [
      "--allow-net=a.com:8080,b.io",
    ]);
  } finally {
    delete process.env.FUNCTIONS_ALLOW_PRIVATE_NETWORK;
  }
  assert.match(netFlags(["a.com"])[1]!, /^--deny-net=/);
});

test("netFlags: wildcards, comma, space, scheme refused", () => {
  assert.equal(
    code(() => netFlags(["*.com"])),
    "functions.invalidDomain",
  );
  assert.equal(
    code(() => netFlags(["*.a.com"])),
    "functions.wildcardDomain",
  );
  for (const d of [
    "a.com,b.com",
    "a.com b.com",
    " a.com",
    "https://a.com",
    "a.com/x",
    "a.com:0",
    "a.com:99999",
    "-a.com",
    "",
  ])
    assert.equal(
      code(() => netFlags([d])),
      "functions.malformedDomain",
      d,
    );
});

test("save schema: domains validated", () => {
  const base = { name: "f", code: "export default () => 1" };
  const ok = functionInputSchema.parse({
    ...base,
    permissions: { domains: ["*", "api.x.io", "1.2.3.4:8443"] },
  });
  assert.deepEqual(ok.permissions.domains, ["*", "api.x.io", "1.2.3.4:8443"]);
  const r = functionInputSchema.safeParse({
    ...base,
    permissions: { domains: ["*.com"] },
  });
  assert.equal(r.success, false);
  assert.match(r.error!.issues[0]!.message, /wildcard top-level/);
  assert.equal(
    functionInputSchema.safeParse({
      ...base,
      permissions: { domains: ["a.com,b.com"] },
    }).success,
    false,
  );
});
