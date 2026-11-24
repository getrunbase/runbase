import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { AppError } from "../errors/app-error";
import {
  defaultExtensions,
  getExtensions,
  loadExtensions,
  registerExtensions,
  resetExtensions,
} from "./index";

const fixture = (n: string) =>
  fileURLToPath(new URL(`./fixtures/${n}.mjs`, import.meta.url));

afterEach(() => resetExtensions());

test("no-op defaults, without any network call", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new Error("network");
  }) as typeof fetch;
  try {
    const ext = getExtensions();
    assert.equal(await ext.telemetry.track("x", { a: 1 }), undefined);
    assert.equal(await ext.billing.entitlements("o"), null);
    assert.equal(await ext.billing.reportUsage("w", "runs", 1), undefined);
    assert.equal(await ext.credentials.oauthClient("google"), null);
    assert.deepEqual(await ext.client.headScripts(), []);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("registerExtensions replaces one point, keeps the others", async () => {
  const events: string[] = [];
  registerExtensions({ telemetry: { track: (e) => void events.push(e) } });
  await getExtensions().telemetry.track("signup");
  assert.deepEqual(events, ["signup"]);
  assert.equal(await getExtensions().billing.entitlements("o"), null);
});

test("registerExtensions refuses an incomplete implementation", () => {
  assert.throws(
    () => registerExtensions({ billing: { entitlements: async () => null } as never }),
    (e: unknown) =>
      e instanceof AppError &&
      e.code === "extensions.invalid" &&
      /billing\.reportUsage must be a function/.test(e.message),
  );
});

test("without RUNBASE_EXTENSIONS: no-op", async () => {
  assert.equal(await loadExtensions(""), false);
  assert.equal(await loadExtensions(undefined), false);
});

test("module not found: silent no-op", async () => {
  assert.equal(await loadExtensions("./does-not-exist/ext.mjs"), false);
  assert.equal(await loadExtensions("@runbase-test/missing-extension"), false);
  assert.deepEqual(Object.keys(getExtensions()), Object.keys(defaultExtensions()));
});

test("valid module: replaces the default implementation", async () => {
  assert.equal(await loadExtensions(fixture("recording")), true);
  assert.deepEqual(await getExtensions().client.headScripts(), [
    { id: "fixture", inline: "window.fixture = 1;" },
  ]);
  assert.equal(await getExtensions().billing.entitlements("o"), null);
});

test("malformed module: explicit error in English", async () => {
  await assert.rejects(
    loadExtensions(fixture("malformed")),
    (e: unknown) =>
      e instanceof AppError &&
      e.code === "extensions.invalid" &&
      e.message.startsWith("Invalid extension module") &&
      /telemetry\.track must be a function/.test(e.message),
  );
});
