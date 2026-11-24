// Envelope encryption: each workspace has its data key
// (DEK, 32 random bytes) that encrypts its secrets; the DEK is stored
// encrypted by the master key. Changing the master key only re-encrypts the DEKs.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../env";

// Master key provider: env today, KMS tomorrow (same interface,
// asynchronous: a KMS encrypts/decrypts remotely).
export interface MasterKeyProvider {
  wrap(dek: Buffer): Promise<string>;
  unwrap(wrapped: string): Promise<Buffer>;
}

// AES-256-GCM, format base64(iv).base64(tag).base64(ciphertext).
export function seal(key: Buffer, plain: Buffer) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString("base64")).join(".");
}

export function open(key: Buffer, stored: string) {
  const [iv, tag, ct] = stored.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", key, iv!);
  d.setAuthTag(tag!);
  return Buffer.concat([d.update(ct!), d.final()]);
}

export function parseKey(b64: string | undefined, name: string) {
  const key = Buffer.from(b64 ?? "", "base64");
  if (key.length !== 32)
    // eslint-disable-next-line no-restricted-syntax -- deployment invariant
    throw new Error(`${name} missing or invalid (32 bytes, base64)`);
  return key;
}

// In-memory master key (env, or rotation: old and new key).
export const keyProvider = (key: Buffer): MasterKeyProvider => ({
  wrap: async (dek) => seal(key, dek),
  unwrap: async (wrapped) => open(key, wrapped),
});

// Master key from the environment (SECRETS_MASTER_KEY), read on each call.
export const envMasterKey: MasterKeyProvider = {
  wrap: (dek) =>
    keyProvider(parseKey(env().SECRETS_MASTER_KEY, "SECRETS_MASTER_KEY")).wrap(
      dek,
    ),
  unwrap: (w) =>
    keyProvider(
      parseKey(env().SECRETS_MASTER_KEY, "SECRETS_MASTER_KEY"),
    ).unwrap(w),
};

// Value encrypted by a DEK: "v2:" prefix.
export const ENVELOPE = "v2:";
export const isEnvelope = (stored: string) => stored.startsWith(ENVELOPE);

export const encryptWith = (dek: Buffer, value: string) =>
  ENVELOPE + seal(dek, Buffer.from(value, "utf8"));

export function decryptWith(dek: Buffer, stored: string) {
  // eslint-disable-next-line no-restricted-syntax -- deployment invariant
  if (!isEnvelope(stored)) throw new Error("Unsupported secret format");
  return open(dek, stored.slice(ENVELOPE.length)).toString("utf8");
}

export const newDek = () => randomBytes(32);
