// Catalog fixture set for tests (core and web): a miniature
// repo (connectors/, templates/, authors/) written to a temporary folder.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const filler = (n: number) => Array.from({ length: n }, () => "word").join(" ");

// Valid description (>= 300 words, four sections) around a free text.
export const validDescription = (text = "") =>
  [
    "## Who it's for",
    `${text} ${filler(300)}`,
    "## The problem",
    "Manual work.",
    "## What it does",
    "Automates it.",
    "## Setup",
    "1. Import the template.",
  ].join("\n\n");

export const fixtureManifest = (name: string, nodes: string[]) => ({
  format: "runbase-template",
  version: 1,
  name,
  workflows: [
    {
      key: "main",
      name,
      definition: {
        trigger: { type: "trigger.manual" },
        steps: nodes.map((n, i) => ({ id: `s${i}`, type: `node.${n}` })),
      },
    },
  ],
});

const write = (path: string, value: unknown) =>
  writeFileSync(
    path,
    typeof value === "string" ? value : JSON.stringify(value, null, 2),
  );

export function writeTemplate(
  root: string,
  t: {
    slug: string;
    name: string;
    author: string;
    categories: string[];
    nodes: string[];
    text?: string;
  },
) {
  const d = join(root, "templates", t.slug);
  mkdirSync(d, { recursive: true });
  write(join(d, "template.json"), {
    id: t.slug,
    slug: t.slug,
    name: t.name,
    categories: t.categories,
    authorId: t.author,
    createdAt: "2026-11-01",
    updatedAt: "2026-11-20",
  });
  write(join(d, "README.md"), validDescription(t.text));
  write(join(d, "runbase-template.json"), fixtureManifest(t.name, t.nodes));
}

export function writeAuthor(root: string, username: string) {
  mkdirSync(join(root, "authors"), { recursive: true });
  write(join(root, "authors", `${username}.json`), {
    username,
    name: username,
    bio: "Builds automations.",
    avatar: `https://github.com/${username}.png`,
    links: [],
  });
}

// Fixture repo: 2 connectors, 2 authors, 3 templates.
export function catalogFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "runbase-catalog-"));
  const connectors = [
    ["mailer", "Mailer", ["mailer.send", "mailer.list"], "email"],
    ["slack", "Slack", ["slack.post"], "communication"],
  ] as const;
  mkdirSync(join(root, "connectors"), { recursive: true });
  write(join(root, "connectors", "registry.json"), {
    connectors: connectors.map(([slug, label, nodes]) => ({
      name: `@getrunbase-connectors/${slug}`,
      version: "0.1.0",
      label,
      path: slug,
      nodes: nodes.map((id) => ({ id, label: id, description: `Run ${id}` })),
    })),
  });
  for (const [slug, label, , category] of connectors) {
    mkdirSync(join(root, "connectors", slug));
    write(join(root, "connectors", slug, "catalog.json"), {
      slug,
      displayName: label,
      icon: slug,
      description: `${label} connector`,
      categories: [category],
      docsUrl: `https://example.com/${slug}`,
      credentialType: "oauth2",
    });
    if (slug === "mailer")
      writeFileSync(
        join(root, "connectors", slug, "README.md"),
        "# Mailer automations\n\nSend emails.\n",
      );
  }
  writeAuthor(root, "octocat");
  writeAuthor(root, "hubot");
  writeTemplate(root, {
    slug: "prospect-reply",
    name: "Prospect reply",
    author: "octocat",
    categories: ["sales"],
    nodes: ["mailer.send"],
    text: "Réponse rapide aux prospects",
  });
  writeTemplate(root, {
    slug: "invoice-reminder",
    name: "Invoice reminder",
    author: "octocat",
    categories: ["finance"],
    nodes: ["mailer.send", "slack.post"],
    text: "Remind customers about unpaid invoices",
  });
  writeTemplate(root, {
    slug: "team-digest",
    name: "Team digest",
    author: "hubot",
    categories: ["sales", "communication"],
    nodes: ["slack.post"],
    text: "Daily summary posted to the team channel",
  });
  return root;
}
