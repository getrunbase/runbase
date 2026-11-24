import { test } from "node:test";
import assert from "node:assert/strict";
import { findPlaceholders } from "./check-placeholders.mjs";

test("reports each line that contains a placeholder", () => {
  const files = {
    "README.md": "ok\ngit clone <repository-url> x\n",
    "docs/a.md": "https://github.com/getrunbase/runbase\n",
  };
  assert.deepEqual(
    findPlaceholders(Object.keys(files), (f) => files[f]),
    ["README.md:2: git clone <repository-url> x"],
  );
});

test("skips unreadable files", () => {
  const read = () => {
    throw new Error("binary");
  };
  assert.deepEqual(findPlaceholders(["a.png"], read), []);
});
