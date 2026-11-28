// Creator program: submitting a template to the catalog
// (catalog validation then a GitHub pull request for human review) and
// signed site revalidation webhook (runbase-cloud) after the merge.
// No payment.
import { createHmac } from "node:crypto";
import { z } from "zod";
import { appError, type ErrorItem } from "../errors/app-error";
import { buildTemplate, catalogInvalid, type Catalog } from "./load";
import { authorSchema, usernameSchema, type CatalogAuthor } from "./schemas";

export const submissionSchema = z.object({
  slug: z.string().describe("Template slug (folder name), e.g. crm-light"),
  name: z.string(),
  categories: z.array(z.string()),
  githubUsername: usernameSchema.describe("Creator's GitHub login (authorId)"),
  description: z
    .string()
    .describe(
      "Markdown, at least 300 words, with the sections: ## Who it's for, ## The problem, ## What it does, ## Setup",
    ),
  manifest: z
    .record(z.string(), z.unknown())
    .describe("The runbase-template.json manifest (template.export)"),
  author: authorSchema
    .optional()
    .describe("Creator profile, required for a first template"),
});
export type Submission = z.input<typeof submissionSchema>;

export type SubmissionFile = { path: string; content: string };

const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

// Validates a submission against the current catalog; returns the PR
// files, or throws catalog.invalid with a readable problem per refused point.
export function prepareSubmission(
  input: Submission,
  catalog: Catalog,
  today = new Date().toISOString().slice(0, 10),
): { files: SubmissionFile[]; connectors: string[] } {
  const s = submissionSchema.parse(input);
  const issues: ErrorItem[] = [];
  if (catalog.templates.some((t) => t.id === s.slug || t.slug === s.slug))
    throw appError(
      "catalog.templateExists",
      "Template {slug} already exists in the catalog: choose another slug",
      { slug: s.slug },
      { kind: "conflict" },
    );
  const owners = new Map<string, string>();
  for (const c of catalog.connectors)
    for (const op of [...c.triggers, ...c.actions]) owners.set(op.name, c.slug);
  const authors = new Set(catalog.authors.map((a) => a.username));
  let newAuthor: CatalogAuthor | undefined;
  if (s.author && !authors.has(s.githubUsername)) {
    if (s.author.username !== s.githubUsername)
      throw appError(
        "catalog.authorMismatch",
        "author.username {username} must equal githubUsername {expected}",
        { username: s.author.username, expected: s.githubUsername },
        { kind: "invalid_input" },
      );
    newAuthor = authorSchema.parse(s.author);
    authors.add(newAuthor.username);
  }
  const meta = {
    id: s.slug,
    slug: s.slug,
    name: s.name,
    categories: s.categories,
    authorId: s.githubUsername,
    createdAt: today,
    updatedAt: today,
  };
  const t = buildTemplate(
    { slug: s.slug, meta, readme: s.description, manifest: s.manifest },
    {
      owners,
      authors,
      categories:
        catalog.categories && new Set(catalog.categories.map((c) => c.slug)),
    },
    issues,
  );
  if (!t) throw catalogInvalid(issues);
  const dir = `templates/${s.slug}`;
  const files = [
    { path: `${dir}/template.json`, content: json(meta) },
    {
      path: `${dir}/README.md`,
      content: s.description.endsWith("\n")
        ? s.description
        : `${s.description}\n`,
    },
    { path: `${dir}/runbase-template.json`, content: json(s.manifest) },
  ];
  if (newAuthor)
    files.push({
      path: `authors/${newAuthor.username}.json`,
      content: json(newAuthor),
    });
  return { files, connectors: t.connectors };
}

// Target repo for submissions: CATALOG_GITHUB_REPO (owner/repo) and
// CATALOG_GITHUB_TOKEN (contents + pull requests permissions).
export function githubConfig() {
  const repo = process.env.CATALOG_GITHUB_REPO;
  const token = process.env.CATALOG_GITHUB_TOKEN;
  if (!repo || !token)
    throw appError(
      "catalog.submissionsDisabled",
      "Template submissions are not configured on this instance (CATALOG_GITHUB_REPO and CATALOG_GITHUB_TOKEN): open a pull request on templates/ instead",
    );
  return {
    repo,
    token,
    api: process.env.CATALOG_GITHUB_API ?? "https://api.github.com",
    base: process.env.CATALOG_GITHUB_BASE ?? "main",
  };
}

// Opens a pull request (branch, one commit per file): human review
// happens on GitHub, CI replays the catalog check.
export async function openPullRequest(
  files: SubmissionFile[],
  pr: { branch: string; title: string; body: string },
) {
  const cfg = githubConfig();
  const gh = async (
    step: string,
    method: string,
    path: string,
    body?: unknown,
  ) => {
    const res = await fetch(`${cfg.api}/repos/${cfg.repo}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${cfg.token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "runbase-catalog",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok)
      throw appError(
        "catalog.githubFailed",
        "GitHub API error {status} while trying to {step}",
        { status: res.status, step },
      );
    return (await res.json()) as Record<string, unknown>;
  };
  const ref = await gh(
    "read the base branch",
    "GET",
    `/git/ref/heads/${cfg.base}`,
  );
  const sha = (ref.object as { sha: string }).sha;
  await gh("create the branch", "POST", "/git/refs", {
    ref: `refs/heads/${pr.branch}`,
    sha,
  });
  for (const f of files)
    await gh("commit a file", "PUT", `/contents/${f.path}`, {
      message: `feat(templates): add ${f.path}`,
      content: Buffer.from(f.content).toString("base64"),
      branch: pr.branch,
    });
  const out = await gh("open the pull request", "POST", "/pulls", {
    title: pr.title,
    head: pr.branch,
    base: cfg.base,
    body: pr.body,
  });
  return { url: String(out.html_url), number: Number(out.number) };
}

// Revalidation webhook signature: HMAC-SHA256 of `<timestamp>.<body>`,
// sent as `x-runbase-signature: sha256=<hex>` with `x-runbase-timestamp`.
export const signRevalidation = (
  secret: string,
  timestamp: string,
  body: string,
) =>
  `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;

// Site pages to revalidate for modified files (merge diff):
// template, its creator, connector, and the indexes.
export function revalidationPaths(changed: string[], catalog: Catalog) {
  const paths = new Set<string>();
  for (const f of changed) {
    const parts = f.split("/");
    const [dir, name] = parts;
    if (dir === "templates" && name && parts.length > 2) {
      paths.add(`/templates/${name}`).add("/templates");
      const t = catalog.templates.find((x) => x.slug === name);
      if (t) paths.add(`/creators/${t.authorId}`);
    } else if (dir === "authors" && name?.endsWith(".json"))
      paths.add(`/creators/${name.slice(0, -5)}`);
    else if (dir === "connectors" && name && name !== "registry.json") {
      const c = catalog.connectors.find((x) => x.slug === name);
      paths.add(`/connectors/${c?.slug ?? name}`).add("/connectors");
    }
  }
  return [...paths].sort();
}

// Sends the signed webhook (CATALOG_REVALIDATE_URL / CATALOG_REVALIDATE_SECRET).
export async function sendRevalidation(
  paths: string[],
  opts: { url: string; secret: string; now?: Date },
) {
  const timestamp = String(
    Math.floor((opts.now ?? new Date()).getTime() / 1000),
  );
  const body = JSON.stringify({ type: "catalog.revalidate", paths });
  const res = await fetch(opts.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Site receiver (runbase-cloud /api/revalidate): Bearer REVALIDATE_SECRET.
      authorization: `Bearer ${opts.secret}`,
      "x-runbase-timestamp": timestamp,
      "x-runbase-signature": signRevalidation(opts.secret, timestamp, body),
    },
    body,
  });
  if (!res.ok)
    throw appError(
      "catalog.revalidateFailed",
      "Revalidation webhook answered {status}",
      { status: res.status },
    );
  return { status: res.status, paths };
}
