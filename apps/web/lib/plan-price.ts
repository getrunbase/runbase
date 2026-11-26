// Prices of the plan picker (Settings › Plan and usage › Plans). Amounts are
// in the smallest currency unit (cents); whole amounts drop the decimals.
export type Interval = "month" | "year";

export function formatPrice(cents: number, currency: string, locale: string): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}

// Price shown for an interval: the amount billed, plus the monthly
// equivalent for yearly billing (rounded to the cent).
export function planPrice(
  plan: { priceMonthlyCents: number; priceYearlyCents: number; currency: string },
  interval: Interval,
  locale: string,
): { amount: string; perMonth: string | null } {
  if (interval === "month")
    return { amount: formatPrice(plan.priceMonthlyCents, plan.currency, locale), perMonth: null };
  return {
    amount: formatPrice(plan.priceYearlyCents, plan.currency, locale),
    perMonth: formatPrice(Math.round(plan.priceYearlyCents / 12), plan.currency, locale),
  };
}
