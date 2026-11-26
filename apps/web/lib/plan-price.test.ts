import assert from "node:assert/strict";
import { test } from "node:test";
import { formatPrice, planPrice } from "./plan-price";

// Intl may use narrow no-break spaces: normalize them.
const s = (v: string | null) => v?.replace(/\s/g, " ") ?? null;

test("formatPrice drops decimals on whole amounts only", () => {
  assert.equal(s(formatPrice(1000, "EUR", "en")), "€10");
  assert.equal(s(formatPrice(1050, "EUR", "en")), "€10.50");
  assert.equal(s(formatPrice(0, "USD", "en")), "$0");
  assert.equal(s(formatPrice(1000, "EUR", "fr")), "10 €");
});

test("planPrice: monthly amount, or yearly amount with its monthly equivalent", () => {
  const plan = { priceMonthlyCents: 1000, priceYearlyCents: 10000, currency: "EUR" };
  assert.deepEqual(planPrice(plan, "month", "en"), { amount: "€10", perMonth: null });
  const y = planPrice(plan, "year", "en");
  assert.equal(y.amount, "€100");
  assert.equal(y.perMonth, "€8.33");
});
