// Loading and validation of the catalog from the repo:
// connectors/ (registry.json + catalog.json per connector), templates/<slug>/
// (template.json, README.md, runbase-template.json) and authors/<login>.json.
// Used by the CI check (scripts/validate-catalog) and the public API index.
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { appError, errorItem, type ErrorItem } from "../errors/app-error";
import { templateSchema as manifestSchema } from "../templates/format";
import { logoDataUrl } from "./logo";
import {
  authorSchema,
  checkDescription,
  connectorMetaSchema,
  connectorSchema,
  deriveConnectors,
  templateMetaSchema,
  zodItems,
  type CatalogAuthor,
  type CatalogConnector,
  type CatalogTemplate,
} from "./schemas";

export type Catalog = {
  connectors: CatalogConnector[];
  templates: CatalogTemplate[];
  authors: CatalogAuthor[];
};
export type CatalogResult = Catalog & { issues: ErrorItem[] };

type RegistryNode = { id: string; label?: string; description?: string };
type Registry = { connectors?: { path: string; nodes?: RegistryNode[] }[] };

const isDir = async (p: string) =>
  (await stat(p).catch(() => null))?.isDirectory() ?? false;

const missing = (where: string) =>
  errorItem("catalog.fileMissing", "{where}: file is missing", { where });

// JSON of a file, or a problem (missing, unreadable).
async function readJson(
  path: string,
  where: string,
  issues: ErrorItem[],
): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    issues.push(missing(where));
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    issues.push(
      errorItem("catalog.invalidJson", "{where}: invalid JSON", { where }),
    );
    return undefined;
  }
}

function parse<T extends z.ZodType>(
  schema: T,
  value: unknown,
  where: string,
  issues: ErrorItem[],
): z.output<T> | undefined {
  if (value === undefined) return undefined;
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  issues.push(...zodItems(where, r.error));
  return undefined;
}

async function loadConnectors(root: string, issues: ErrorItem[]) {
  const dir = join(root, "connectors");
  const owners = new Map<string, string>();
  const connectors: CatalogConnector[] = [];
  if (!(await isDir(dir))) return { connectors, owners };
  const registry = (await readJson(
    join(dir, "registry.json"),
    "connectors/registry.json",
    issues,
  )) as Registry | undefined;
  for (const entry of registry?.connectors ?? []) {
    const where = `connectors/${entry.path}/catalog.json`;
    const meta = parse(
      connectorMetaSchema,
      await readJson(join(dir, entry.path, "catalog.json"), where, issues),
      where,
      issues,
    );
    if (!meta) continue;
    const nodes = entry.nodes ?? [];
    const op = (n: RegistryNode) => ({
      name: n.id,
      description: n.description || n.label || n.id,
    });
    const isTrigger = (n: RegistryNode) =>
      (n as { kind?: string }).kind === "trigger";
    const logo = await logoDataUrl(join(dir, entry.path));
    connectors.push(
      connectorSchema.parse({
        ...meta,
        ...(logo && { logo }),
        triggers: nodes.filter(isTrigger).map(op),
        actions: nodes.filter((n) => !isTrigger(n)).map(op),
      }),
    );
    for (const n of nodes) owners.set(n.id, meta.slug);
  }
  return { connectors, owners };
}

async function loadAuthors(root: string, issues: ErrorItem[]) {
  const dir = join(root, "authors");
  const authors: CatalogAuthor[] = [];
  if (!(await isDir(dir))) return authors;
  for (const file of (await readdir(dir)).sort()) {
    if (!file.endsWith(".json")) continue;
    const where = `authors/${file}`;
    const a = parse(
      authorSchema,
      await readJson(join(dir, file), where, issues),
      where,
      issues,
    );
    if (!a) continue;
    if (`${a.username}.json` !== file)
      issues.push(
        errorItem(
          "catalog.authorFileName",
          "{where}: file must be named {expected}",
          { where, expected: `${a.username}.json` },
        ),
      );
    else authors.push(a);
  }
  return authors;
}

// Validates a template (folder or submission): metadata, description,
// manifest, author profile. Returns the full template, or undefined + problems.
export function buildTemplate(
  input: { slug: string; meta: unknown; readme: string; manifest: unknown },
  ctx: { owners: Map<string, string>; authors: Set<string> },
  issues: ErrorItem[],
): CatalogTemplate | undefined {
  const base = `templates/${input.slug}`;
  const before = issues.length;
  const meta = parse(
    templateMetaSchema,
    input.meta,
    `${base}/template.json`,
    issues,
  );
  issues.push(...checkDescription(input.readme, `${base}/README.md`));
  const manifest = parse(
    manifestSchema,
    input.manifest,
    `${base}/runbase-template.json`,
    issues,
  );
  if (meta) {
    if (meta.slug !== input.slug)
      issues.push(
        errorItem(
          "catalog.slugMismatch",
          "{where}: slug {slug} must match the folder name {folder}",
          {
            where: `${base}/template.json`,
            slug: meta.slug,
            folder: input.slug,
          },
        ),
      );
    if (!ctx.authors.has(meta.authorId))
      issues.push(
        errorItem(
          "catalog.authorMissing",
          "{where}: author {author} has no profile, add authors/{author}.json",
          { where: `${base}/template.json`, author: meta.authorId },
        ),
      );
  }
  if (!meta || !manifest || issues.length > before) return undefined;
  return {
    ...meta,
    description: input.readme,
    manifest: input.manifest as Record<string, unknown>,
    connectors: deriveConnectors(manifest, ctx.owners),
  };
}

async function loadTemplates(
  root: string,
  ctx: { owners: Map<string, string>; authors: Set<string> },
  issues: ErrorItem[],
) {
  const dir = join(root, "templates");
  const templates: CatalogTemplate[] = [];
  if (!(await isDir(dir))) return templates;
  for (const name of (await readdir(dir)).sort()) {
    const d = join(dir, name);
    if (!(await isDir(d))) continue;
    const base = `templates/${name}`;
    const meta = await readJson(
      join(d, "template.json"),
      `${base}/template.json`,
      issues,
    );
    const manifest = await readJson(
      join(d, "runbase-template.json"),
      `${base}/runbase-template.json`,
      issues,
    );
    const readme = await readFile(join(d, "README.md"), "utf8").catch(() => {
      issues.push(missing(`${base}/README.md`));
      return "";
    });
    if (meta === undefined || manifest === undefined) continue;
    const t = buildTemplate(
      { slug: name, meta, readme, manifest },
      ctx,
      issues,
    );
    if (!t) continue;
    if (templates.some((o) => o.id === t.id))
      issues.push(
        errorItem("catalog.duplicateId", "{where}: duplicate id {id}", {
          where: `${base}/template.json`,
          id: t.id,
        }),
      );
    else templates.push(t);
  }
  return templates;
}

// Full catalog of a repo root, with the list of problems.
export async function loadCatalog(root: string): Promise<CatalogResult> {
  const issues: ErrorItem[] = [];
  const { connectors, owners } = await loadConnectors(root, issues);
  const authors = await loadAuthors(root, issues);
  const templates = await loadTemplates(
    root,
    { owners, authors: new Set(authors.map((a) => a.username)) },
    issues,
  );
  return { connectors, templates, authors, issues };
}

// Error built from the problems (MCP, API).
export const catalogInvalid = (issues: ErrorItem[]) =>
  appError(
    "catalog.invalid",
    "Invalid catalog entry ({count} problem(s)):\n{details}",
    { count: issues.length, details: issues.map((i) => i.message).join("\n") },
    { kind: "invalid_input", items: issues },
  );
