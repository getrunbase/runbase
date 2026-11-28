// Public catalog service: read-only over an in-memory index,
// no table. Source: CATALOG_INDEX (JSON generated at build by
// `pnpm catalog:validate --out <file>`), otherwise the repo folders
// (CATALOG_ROOT, or the nearest root containing templates/ walking up).
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { notFound } from "../errors/app-error";
import { loadCatalog, type Catalog } from "./load";
import type { CatalogTemplate } from "./schemas";
import { openPullRequest, prepareSubmission, type Submission } from "./publish";
import { foldAccents } from "../lib/slug";
import { logger } from "../logger";

let index: Promise<Catalog> | undefined;

async function findRoot(): Promise<string> {
  if (process.env.CATALOG_ROOT) return process.env.CATALOG_ROOT;
  for (let d = process.cwd(); ; d = dirname(d)) {
    if ((await stat(join(d, "templates")).catch(() => null))?.isDirectory())
      return d;
    if (dirname(d) === d) return process.cwd();
  }
}

async function build(): Promise<Catalog> {
  if (process.env.CATALOG_INDEX)
    return JSON.parse(
      await readFile(process.env.CATALOG_INDEX, "utf8"),
    ) as Catalog;
  const { issues, ...catalog } = await loadCatalog(await findRoot());
  // An invalid entry is discarded (the CI check refuses it at merge).
  if (issues.length)
    logger.warn({ invalid: issues.length }, "catalog: invalid entries skipped");
  return catalog;
}

const catalog = () => {
  index ??= build().catch((e) => {
    index = undefined;
    throw e;
  });
  return index;
};

// Reloads the index on the next call (tests, revalidation).
export const resetCatalog = () => {
  index = undefined;
};

// Lowercase without accents, for full-text search.
const norm = foldAccents;

const EXCERPT_MAX = 280;

// Short card text: the manifest's one-line description when present,
// otherwise the README's first non-heading paragraph. Cut at a word
// boundary when still too long.
export const excerpt = (
  markdown: string,
  manifest?: Record<string, unknown>,
) => {
  const short =
    typeof manifest?.description === "string"
      ? manifest.description.trim()
      : "";
  const paragraph =
    markdown
      .replace(/```[\s\S]*?```/g, "\n\n")
      .split(/\n\s*\n/)
      .map((p) =>
        p
          .split("\n")
          .filter((l) => !/^\s*#/.test(l))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .find(Boolean) ?? "";
  const text = short || paragraph;
  if (text.length <= EXCERPT_MAX) return text;
  const cut = text.slice(0, EXCERPT_MAX - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "")}…`;
};

// Short entry of a template (lists): without manifest or full description.
export const templateSummary = (t: CatalogTemplate) => ({
  id: t.id,
  slug: t.slug,
  name: t.name,
  excerpt: excerpt(t.description, t.manifest),
  categories: t.categories,
  connectors: t.connectors,
  authorId: t.authorId,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
});
export type TemplateSummary = ReturnType<typeof templateSummary>;

export type TemplateQuery = {
  q?: string;
  category?: string;
  connector?: string;
  limit?: number;
  // Cursor: `next` of the previous page (id of the last returned template).
  after?: string;
};

export const MAX_PAGE = 100;

export const catalogService = {
  // Full-text search (all words, accent-insensitive) on name, description,
  // categories, connectors and author; stable sort by id, keyset pagination.
  async searchTemplates(query: TemplateQuery = {}) {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), MAX_PAGE);
    const terms = norm(query.q ?? "")
      .split(/\s+/)
      .filter(Boolean);
    const { templates } = await catalog();
    const matches = templates
      .filter((t) => !query.category || t.categories.includes(query.category))
      .filter((t) => !query.connector || t.connectors.includes(query.connector))
      .filter((t) => {
        if (!terms.length) return true;
        const hay = norm(
          [
            t.name,
            t.description,
            t.authorId,
            ...t.categories,
            ...t.connectors,
          ].join(" "),
        );
        return terms.every((w) => hay.includes(w));
      })
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const total = matches.length;
    const rest = query.after
      ? matches.filter((t) => t.id > query.after!)
      : matches;
    const page = rest.slice(0, limit);
    return {
      data: page.map(templateSummary),
      next: rest.length > limit ? page[page.length - 1]!.id : null,
      total,
    };
  },

  // Full template by id or slug.
  async getTemplate(idOrSlug: string) {
    const { templates } = await catalog();
    const t = templates.find((x) => x.id === idOrSlug || x.slug === idOrSlug);
    if (!t)
      throw notFound(
        "catalog.templateNotFound",
        "Template {id} not found in the catalog",
        { id: idOrSlug },
      );
    return t;
  },

  async listConnectors(query: { category?: string } = {}) {
    const { connectors } = await catalog();
    return connectors
      .filter((c) => !query.category || c.categories.includes(query.category))
      .sort((a, b) => a.slug.localeCompare(b.slug));
  },

  async getConnector(slug: string) {
    const { connectors, templates } = await catalog();
    const c = connectors.find((x) => x.slug === slug);
    if (!c)
      throw notFound(
        "catalog.connectorNotFound",
        "Connector {slug} not found in the catalog",
        { slug },
      );
    return {
      ...c,
      templates: templates
        .filter((t) => t.connectors.includes(slug))
        .map(templateSummary),
    };
  },

  // Creator (GitHub login, case-insensitive) and their templates.
  async getCreator(username: string) {
    const { authors, templates } = await catalog();
    const a = authors.find(
      (x) => x.username.toLowerCase() === username.toLowerCase(),
    );
    if (!a)
      throw notFound(
        "catalog.creatorNotFound",
        "Creator {username} not found in the catalog",
        { username },
      );
    return {
      ...a,
      templates: templates
        .filter((t) => t.authorId === a.username)
        .map(templateSummary),
    };
  },

  // Creator submission: automatic validation,
  // then a pull request for human review. Published at merge.
  async submit(input: Submission) {
    const { files, connectors } = prepareSubmission(input, await catalog());
    const pullRequest = await openPullRequest(files, {
      branch: `templates/${input.slug}-${Date.now().toString(36)}`,
      title: `feat(templates): add ${input.slug}`,
      body: [
        `Template submitted by @${input.githubUsername} through the MCP tool templates.submit.`,
        "",
        "Automatic validation passed (description, setup section, manifest, author profile).",
        "Reviewer checklist: see CONTRIBUTING.md, section Submitting a template.",
        "",
        ...files.map((f) => `- \`${f.path}\``),
      ].join("\n"),
    });
    return {
      status: "in_review" as const,
      pullRequest,
      connectors,
      files: files.map((f) => f.path),
    };
  },
};
