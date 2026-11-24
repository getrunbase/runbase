import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cn } from "./utils";

// Repris de agentic-cloud/apps/site/lib/utils.test.ts.
describe("cn", () => {
  it("garde la couleur avec une taille du design system", () => {
    assert.equal(cn("text-primary-foreground", "text-h1"), "text-primary-foreground text-h1");
    assert.equal(cn("text-display", "text-muted-foreground"), "text-display text-muted-foreground");
  });

  it("fusionne deux tailles de texte", () => {
    assert.equal(cn("text-sm", "text-lead"), "text-lead");
    assert.equal(cn("text-h2", "text-base"), "text-base");
  });

  it("fusionne deux couleurs de texte", () => {
    assert.equal(cn("text-foreground", "text-tag-blue-fg"), "text-tag-blue-fg");
  });
});
