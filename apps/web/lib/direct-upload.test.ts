// Direct browser -> bucket upload: PUT of the file with the signed type,
// failure (status, network) reported as false.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileInfo, putToBucket } from "./direct-upload";

test("putToBucket: PUT of the bytes with the signed content-type", async () => {
  const got: { method?: string; type?: string; url?: string; body: string }[] =
    [];
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      got.push({
        method: req.method,
        type: req.headers["content-type"],
        url: req.url,
        body,
      });
      res.statusCode = req.url === "/fail" ? 403 : 200;
      res.end();
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  try {
    const f = new File(["memo"], "note.txt", { type: "text/plain" });
    assert.deepEqual(fileInfo(f), {
      name: "note.txt",
      type: "text/plain",
      size: 4,
    });
    const meta = {
      key: "ws/u/note.txt",
      name: "note.txt",
      size: 4,
      type: "text/plain",
    };
    assert.equal(
      await putToBucket([{ file: meta, url: `${base}/ok` }], [f]),
      true,
    );
    assert.deepEqual(got[0], {
      method: "PUT",
      type: "text/plain",
      url: "/ok",
      body: "memo",
    });
    assert.equal(
      await putToBucket(
        [
          { file: meta, url: `${base}/ok` },
          { file: meta, url: `${base}/fail` },
        ],
        [f, f],
      ),
      false,
    );
  } finally {
    srv.close();
  }
  // Unreachable network: false, no exception.
  const f = new File(["x"], "x.bin");
  const meta = {
    key: "k",
    name: "x.bin",
    size: 1,
    type: "application/octet-stream",
  };
  assert.equal(
    await putToBucket([{ file: meta, url: "http://127.0.0.1:1/x" }], [f]),
    false,
  );
});
