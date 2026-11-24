import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escapeHtml,
  magicLinkEmail,
  resetPasswordEmail,
  verifyEmailEmail,
} from "./magic-link-email";

test("templates: link included, English", () => {
  const m = magicLinkEmail("https://x/l");
  assert.equal(m.subject, "Your Runbase sign-in link");
  assert.ok(m.html.includes('href="https://x/l"'));
  assert.ok(resetPasswordEmail("https://x/r").text.includes("https://x/r"));
});

test("templates: URL escaped in HTML", () => {
  assert.equal(escapeHtml(`a"<b>&'`), "a&#34;&#60;b&#62;&#38;&#39;");
  const m = magicLinkEmail('https://x/l?a=1&b="><script>');
  assert.ok(!m.html.includes("<script>"));
  assert.ok(verifyEmailEmail("https://x/v").html.includes('href="https://x/v"'));
});
