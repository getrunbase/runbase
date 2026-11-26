// Public catalog data model: connectors, templates and
// authors, read from the repo's connectors/, templates/ and authors/. Pure
// schemas (no disk or database access): importable anywhere. No view
// counter or verified badge (decision 2026-11-23).
import { z } from "zod";
import { errorItem, type ErrorItem } from "../errors/app-error";
import type { Template as Manifest } from "../templates/format";

export const MIN_DESCRIPTION_WORDS = 300;

const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug: lowercase letters, digits, -");
// GitHub login: 1 to 39 characters, alphanumerics and non-doubled hyphens.
export const usernameSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/,
    "username: a GitHub login",
  );
const category = z.string().regex(/^[a-z0-9-]+$/, "category: [a-z0-9-]");
const date = z.iso.date();

const operation = z.strictObject({
  name: z.string().min(1),
  description: z.string().min(1),
});

// Entered metadata of a connector: connectors/<folder>/catalog.json.
// Triggers and actions come from its nodes (registry.json), never entered.
export const connectorMetaSchema = z.strictObject({
  slug,
  displayName: z.string().min(1).max(100),
  icon: z.string().min(1),
  description: z.string().min(1).max(1000),
  categories: z.array(category).min(1),
  docsUrl: z.url(),
  credentialType: z.enum(["oauth2", "apiKey", "basic", "none"]),
});

export const connectorSchema = connectorMetaSchema.extend({
  // From the connector's logo.svg (data URL), never entered.
  logo: z.string().startsWith("data:image/svg+xml;base64,").optional(),
  triggers: z.array(operation),
  actions: z.array(operation),
});
export type CatalogConnector = z.output<typeof connectorSchema>;

// Entered metadata of a template: templates/<slug>/template.json.
// The description is the sibling README.md, the manifest runbase-template.json.
export const templateMetaSchema = z.strictObject({
  id: slug,
  slug,
  name: z.string().min(1).max(200),
  categories: z.array(category).min(1),
  authorId: usernameSchema,
  createdAt: date,
  updatedAt: date,
});

export const templateSchema = templateMetaSchema.extend({
  description: z.string(),
  manifest: z.record(z.string(), z.unknown()),
  // Derived from the manifest (deriveConnectors), never entered.
  connectors: z.array(slug),
});
export type CatalogTemplate = z.output<typeof templateSchema>;

// Author profile: authors/<username>.json (username = GitHub login).
export const authorSchema = z.strictObject({
  username: usernameSchema,
  name: z.string().min(1).max(100),
  bio: z.string().max(500).default(""),
  avatar: z.url(),
  links: z
    .array(z.strictObject({ label: z.string().min(1), url: z.url() }))
    .default([]),
});
export type CatalogAuthor = z.output<typeof authorSchema>;

// Required sections of the description (markdown headings, level 2 or 3).
export const REQUIRED_SECTIONS = {
  audience: { title: "Who it's for", match: /^who (it'?s|it is|is it) for/i },
  problem: { title: "The problem", match: /problem/i },
  features: { title: "What it does", match: /^what it does/i },
  setup: {
    title: "Setup",
    match: /^(setup|set up|setting up|getting started|installation)/i,
  },
} as const;

// Words of the text, code blocks excluded.
export const wordCount = (markdown: string) =>
  markdown
    .replace(/```[\s\S]*?```/g, " ")
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

// Problems of a description: minimum length and present sections.
export function checkDescription(markdown: string, where: string): ErrorItem[] {
  const out: ErrorItem[] = [];
  const words = wordCount(markdown);
  if (words < MIN_DESCRIPTION_WORDS)
    out.push(
      errorItem(
        "catalog.descriptionTooShort",
        "{where}: description has {words} words, at least {min} are required",
        { where, words, min: MIN_DESCRIPTION_WORDS },
      ),
    );
  const headings = [...markdown.matchAll(/^#{2,3}\s+(.+?)\s*#*\s*$/gm)].map(
    (m) => m[1]!,
  );
  for (const s of Object.values(REQUIRED_SECTIONS))
    if (!headings.some((h) => s.match.test(h)))
      out.push(
        errorItem(
          "catalog.sectionMissing",
          '{where}: description is missing the "## {section}" section',
          { where, section: s.title },
        ),
      );
  return out;
}

// Connectors used by a manifest: `node.<id>` steps of its workflows,
// attached to the connector that declares that node. `owners`: node id -> slug.
export function deriveConnectors(
  manifest: Pick<Manifest, "workflows">,
  owners: Map<string, string>,
): string[] {
  const found = new Set<string>();
  for (const w of manifest.workflows)
    for (const step of w.definition.steps) {
      const type = typeof step.type === "string" ? step.type : "";
      const owner = type.startsWith("node.")
        ? owners.get(type.slice(5))
        : undefined;
      if (owner) found.add(owner);
    }
  return [...found].sort();
}

// zod errors -> readable items, prefixed by the file.
export const zodItems = (where: string, e: z.ZodError): ErrorItem[] =>
  e.issues.map((i) =>
    errorItem("catalog.invalidFile", "{where}: {path}{message}", {
      where,
      path: i.path.length ? `${i.path.join(".")}: ` : "",
      message: i.message,
    }),
  );
