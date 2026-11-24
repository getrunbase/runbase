import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIcon, toIconName } from "./icon";

test("lucide icon: kebab or Pascal, unknown ones refused", () => {
  assert.equal(toIconName("layout-dashboard"), "layout-dashboard");
  assert.equal(toIconName("ShoppingCart"), "shopping-cart");
  assert.equal(toIconName("Building2"), "building-2");
  assert.equal(toIconName("nope-nope"), null);
  assert.throws(() => parseIcon("Nope"), /Unknown lucide icon/);
});
