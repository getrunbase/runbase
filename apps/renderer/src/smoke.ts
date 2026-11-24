// Container smoke test: launches Chromium with the production options and
// screenshots one page. Exits non-zero on failure. Run inside the renderer
// image (read_only, cap_drop ALL) by .github/workflows/selfhost-smoke.yml.
import { env } from "@getrunbase/core/env";
import { launchOptions } from "./screenshot";

export const SMOKE_HTML =
  "<!doctype html><title>smoke</title><h1 id=ok>renderer smoke</h1>";

export async function renderSmoke() {
  const { chromium } = await import("playwright-core");
  const path = env().PLAYWRIGHT_CHROMIUM_PATH;
  const browser = await chromium.launch({
    ...(path ? { executablePath: path } : { channel: "chromium-headless-shell" }),
    ...launchOptions(),
  });
  try {
    const page = await browser.newPage();
    await page.setContent(SMOKE_HTML);
    const text = await page.textContent("#ok");
    const png = await page.screenshot();
    return { text, bytes: png.length };
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await renderSmoke();
  if (r.text !== "renderer smoke" || r.bytes < 100) {
    console.error("renderer smoke failed", r);
    process.exit(1);
  }
  console.log(`renderer smoke ok (${r.bytes} bytes)`);
}
