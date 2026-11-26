import assert from "node:assert/strict";
import { test } from "node:test";
import { formatPrice, planPrice } from "./plan-price";

// Intl may use narrow no-break spaces: normalize them.
const s = (v: string | null) => v?.replace(/\s/g, " ") ?? null;

test("formatPrice drops decimals on whole amounts only", () => {
  assert.equal(s(formatPrice(2900, "EUR", "en")), "€29");
  assert.equal(s(formatPrice(2950, "EUR", "en")), "€29.50");
  assert.equal(s(formatPrice(0, "USD", "en")), "$0");
  assert.equal(s(formatPrice(2900, "EUR", "fr")), "29 €");
});

test("planPrice: monthly amount, or yearly amount with its monthly equivalent", () => {
  const plan = { priceMonthlyCents: 2900, priceYearlyCents: 29000, currency: "EUR" };
  assert.deepEqual(planPrice(plan, "month", "en"), { amount: "€29", perMonth: null });
  const y = planPrice(plan, "year", "en");
  assert.equal(y.amount, "€290");
  assert.equal(y.perMonth, "€24.17");
});
