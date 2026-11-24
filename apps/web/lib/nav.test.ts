import assert from "node:assert/strict";
import { test } from "node:test";
import { translator } from "./i18n-test";
import { buildNav as build } from "./nav";

const t = translator("fr", "nav");
const buildNav = (
  i: Parameters<typeof build>[0],
  r: Parameters<typeof build>[1],
) => build(i, r, t);

const input = {
  databases: [{ id: "d1", name: "CRM", slug: "crm" }],
  objects: [{ databaseId: "d1", name: "Contacts", slug: "contacts" }],
  pages: Array.from({ length: 7 }, (_, i) => ({
    id: `p${i}`,
    name: `Page ${i}`,
  })),
  openErrors: 2,
  waitingApprovals: 3,
};

test("buildNav: a few clear groups, Settings at the bottom", () => {
  const nav = buildNav(input, "owner");
  assert.deepEqual(
    nav.sections.map((s) => s.label),
    [undefined, "Interfaces", "Données", "Automatisations", undefined],
  );
  const bottom = nav.sections.at(-1)!;
  assert.equal(bottom.bottom, true);
  assert.deepEqual(
    bottom.items.map((e) => e.url),
    ["/settings"],
  );
  assert.ok(nav.sections[2]!.items.every((e) => e.url !== "/databases"));
  assert.equal(nav.sections[2]!.items[0]!.items![0]!.url, "/objects/contacts");
});

test("buildNav: approvals and errors badges", () => {
  const auto = buildNav(input, "member").sections[3]!.items;
  assert.equal(auto.find((e) => e.url === "/approvals")!.badge, 3);
  assert.equal(auto.find((e) => e.url === "/errors")!.badge, 2);
});

test("buildNav: interfaces at the top, all listed, no \"all\" link", () => {
  const ui = buildNav(input, "member").sections[1]!.items;
  assert.equal(ui.length, 7);
  assert.ok(ui.every((e) => e.url !== "/interfaces"));
});

test("buildNav: functions and webhooks under Automations", () => {
  const urls = buildNav(input, "member").sections[3]!.items.map((e) => e.url);
  assert.ok(urls.includes("/functions") && urls.includes("/webhooks"));
});

test("buildNav: the end user only sees their pages", () => {
  const nav = buildNav(input, "end_user");
  assert.equal(nav.pagesOnly, true);
  assert.equal(nav.sections.length, 1);
  assert.ok(nav.sections[0]!.items.every((e) => e.url.startsWith("/p")));
  assert.equal(nav.names["/p/p6"]!.title, "Page 6");
});

test("buildNav: English labels", () => {
  const nav = build(input, "owner", translator("en", "nav"));
  assert.deepEqual(
    nav.sections.map((s) => s.label),
    [undefined, "Interfaces", "Data", "Automations", undefined],
  );
});
