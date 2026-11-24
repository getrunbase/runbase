// Unit tests: envelope encryption and rotation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  decryptWith,
  encryptWith,
  isEnvelope,
  keyProvider,
  newDek,
  seal,
} from "./crypto";

test("DEK: encrypts and decrypts, random IV, tampering detected", () => {
  const dek = newDek();
  const a = encryptWith(dek, "sk-secret");
  const b = encryptWith(dek, "sk-secret");
  assert.ok(isEnvelope(a));
  assert.notEqual(a, b);
  assert.equal(decryptWith(dek, a), "sk-secret");
  assert.throws(() => decryptWith(newDek(), a));
  const [iv, tag, ct] = a.slice(3).split(".");
  const flipped = Buffer.from(ct!, "base64");
  flipped[0]! ^= 1;
  assert.throws(() =>
    decryptWith(dek, `v2:${iv}.${tag}.${flipped.toString("base64")}`),
  );
});

test("rotation: only the DEK is re-encrypted, secrets stay readable", async () => {
  const oldKey = keyProvider(randomBytes(32));
  const newKey = keyProvider(randomBytes(32));
  const dek = newDek();
  const wrapped = await oldKey.wrap(dek);
  const secret = encryptWith(dek, "tok-123");
  // Rotation = unwrap with the old key, wrap with the new one.
  const rewrapped = await newKey.wrap(await oldKey.unwrap(wrapped));
  assert.notEqual(rewrapped, wrapped);
  await assert.rejects(oldKey.unwrap(rewrapped));
  // The unchanged secret is read with the DEK from the new envelope.
  assert.equal(decryptWith(await newKey.unwrap(rewrapped), secret), "tok-123");
});

test("non-envelope value is rejected", () => {
  assert.throws(() => decryptWith(newDek(), seal(newDek(), Buffer.from("x"))));
});
