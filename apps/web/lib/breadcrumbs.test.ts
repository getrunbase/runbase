import { test } from "node:test";
import assert from "node:assert/strict";
import { crumbs as c } from "./breadcrumbs";
import { translator } from "./i18n-test";

const t = translator("fr", "nav");
const crumbs = (p: string, n: typeof names, title?: string) =>
  c(p, n, title, t);

const names = {
  "/p/1": { title: "CRM", icon: "users" },
  "/workflows/w": { title: "Relance" },
};

test("interface: icon + name only", () => {
  assert.deepEqual(crumbs("/p/1", names), [
    { label: "CRM", href: "/p/1", icon: "users" },
  ]);
});

test("section › collection › resource, no raw segment", () => {
  assert.deepEqual(
    crumbs("/workflows/w/edit", names).map((c) => c.label),
    ["Automatisations", "Workflows", "Relance"],
  );
  assert.deepEqual(
    crumbs("/runs/0b0e2c1a-1111-2222", names, "Run #4").map((c) => c.label),
    ["Automatisations", "Exécutions", "Run #4"],
  );
  assert.deepEqual(
    crumbs("/errors", names).map((c) => c.label),
    ["Automatisations", "Erreurs"],
  );
  assert.deepEqual(crumbs("/", names), [{ label: "Accueil" }]);
  assert.deepEqual(
    crumbs("/settings/api-keys", names).map((c) => c.label),
    ["Paramètres", "Clés API"],
  );
});

test("English labels", () => {
  assert.deepEqual(
    c("/errors", names, undefined, translator("en", "nav")).map((x) => x.label),
    ["Automations", "Errors"],
  );
});
