import postgres from "postgres";
import { chromium } from "playwright-core";
const base = "http://localhost:7197";
const out = process.argv[2];
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const email = "captures-age150@runbase.test";
await fetch(`${base}/api/auth/sign-in/magic-link`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ email, callbackURL: "/" }) });
const [row] = await sql`select identifier from verification where value like ${"%" + email + "%"} order by created_at desc limit 1`;
const token = row!.identifier.replace(/^magic-link:/, "");
const browser = await chromium.launch({ channel: "chrome" });
const routes = ["/login", "/", "/databases", "/workflows", "/runs", "/settings"];
for (const [w, h, tag] of [[1440, 900, "1440"], [390, 844, "390"]] as const) {
  const anon = await browser.newPage({ viewport: { width: w, height: h } });
  await anon.goto(`${base}/login`, { timeout: 180000 });
  await anon.waitForTimeout(1500);
  await anon.screenshot({ path: `${out}/login-${tag}.png` });
  await anon.close();
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: "fr-FR" });
  const page = await ctx.newPage();
  if (tag === "1440") await page.goto(`${base}/api/auth/magic-link/verify?token=${token}&callbackURL=/`, { timeout: 180000 });
  else {
    await fetch(`${base}/api/auth/sign-in/magic-link`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ email, callbackURL: "/" }) });
    const [r2] = await sql`select identifier from verification where value like ${"%" + email + "%"} order by created_at desc limit 1`;
    await page.goto(`${base}/api/auth/magic-link/verify?token=${r2!.identifier.replace(/^magic-link:/, "")}&callbackURL=/`, { timeout: 180000 });
  }
  for (const r of routes.slice(1)) {
    await page.goto(base + r, { timeout: 180000, waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/${r === "/" ? "home" : r.slice(1)}-${tag}.png` });
  }
  await ctx.close();
}
await browser.close();
await sql.end();
