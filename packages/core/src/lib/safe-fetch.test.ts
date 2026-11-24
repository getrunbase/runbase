import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { safeFetch } from "./safe-fetch";

// Local server: private network allowed for this test only.
process.env.FUNCTIONS_ALLOW_PRIVATE_NETWORK = "1";
process.env.HTTP_BLOCK_MAX_BYTES = "1000";

const server = createServer((req, res) => {
  const n = Number(new URL(req.url!, "http://x").searchParams.get("n"));
  // Chunked (no content-length) to exercise the streaming cap.
  if (req.url!.includes("chunked")) {
    res.write("a".repeat(n / 2));
    res.end("a".repeat(n / 2));
  } else res.end("a".repeat(n));
});
after(() => server.close());

const base = async () => {
  if (!server.listening)
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

test("safeFetch: body under the cap is returned", async () => {
  const res = await safeFetch(`${await base()}/?n=500`, {
    method: "GET",
    headers: {},
  });
  assert.equal((await res.text()).length, 500);
});

test("safeFetch: body over the cap is refused (content-length and streamed)", async () => {
  for (const path of ["/?n=5000", "/chunked?n=5000"])
    await assert.rejects(
      safeFetch(`${await base()}${path}`, { method: "GET", headers: {} }),
      (e: { code?: string }) => e.code === "http.responseTooLarge",
    );
});
