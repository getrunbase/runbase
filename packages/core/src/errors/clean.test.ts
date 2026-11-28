// Error cleanup and fingerprint: no DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanError,
  fingerprint,
  normalizePaths,
  stripAnsi,
  truncateStack,
} from "./clean";

const DENO =
  "function failed (1): \x1B[0m\x1B[1m\x1B[31merror\x1B[0m: Uncaught (in promise) Error: boom\n" +
  "    at \x1B[0m\x1B[1m\x1B[3mdefault\x1B[0m (\x1B[0m\x1B[36mfile:///tmp/fn-dbElw7/fn.ts\x1B[0m:\x1B[0m\x1B[33m1\x1B[0m:\x1B[0m\x1B[33m35\x1B[0m)\n" +
  "    at file:///private/var/folders/44/T/fn-Ab_12z/main.ts:47:19";

test("ANSI removed", () => {
  assert.equal(
    stripAnsi("\x1B[31mrouge\x1B[0m \x1B]8;;u\x07lien"),
    "rouge lien",
  );
  assert.ok(!cleanError(DENO).includes("\x1B"));
});

test("sandbox paths normalized, line:column kept", () => {
  assert.equal(
    cleanError(DENO),
    "function failed (1): error: Uncaught (in promise) Error: boom\n" +
      "    at default (fn.ts:1:35)\n" +
      "    at main.ts:47:19",
  );
  assert.equal(normalizePaths("/tmp/fn-x1/fn.ts:2:3"), "fn.ts:2:3");
  assert.equal(normalizePaths("file:///home/a/b.ts"), "file:///home/a/b.ts");
});

test("stack truncated to 20 lines / 4 KB", () => {
  const long = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");
  const t = truncateStack(long);
  assert.equal(t.split("\n").length, 21);
  assert.match(t, /… \(truncated\)$/);
  assert.ok(Buffer.byteLength(truncateStack("é".repeat(5000))) <= 4096 + 20);
  assert.equal(truncateStack("court"), "court");
});

test("fingerprint: identical despite ids, numbers, paths, colors", () => {
  const a = fingerprint(
    "Record 3f2a1c9e-1b2c-4d5e-8f90-123456789abc not found after 3 tries at \x1B[36mfile:///tmp/fn-aaa/fn.ts\x1B[0m:12:4",
  );
  const b = fingerprint(
    "record 9e8d7c6b-1b2c-4d5e-8f90-abcdefabcdef not found after 12 tries at file:///tmp/fn-bbb/fn.ts:40:1",
  );
  assert.equal(a, b);
  assert.notEqual(a, fingerprint("Another failure"));
  assert.match(a, /^[0-9a-f]{32}$/);
});

test("thrownMessage: thrown message only, no Deno prefix nor stack", async () => {
  const { thrownMessage } = await import("./clean");
  assert.equal(thrownMessage(DENO), "boom");
  assert.equal(
    thrownMessage("error: Uncaught TypeError: x is not a function\n    at a"),
    "x is not a function",
  );
  assert.equal(thrownMessage('error: Uncaught "plain string"'), '"plain string"');
  assert.equal(thrownMessage("Killed"), null);
});
