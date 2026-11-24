// Pages: a page is a multi-file TSX package ({ path: source },
// `entry` entry point). The `pages` columns hold the draft; publishing
// pins an immutable snapshot in `page_versions`, pointed to by currentVersion.
import { createHash } from "node:crypto";
import { and, count, desc, eq, gt, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { requireScope } from "../api-keys";
import { audit } from "../audit";
import { pageErrors, pages, pageVersions, type PageFiles } from "../db/schema";
import { appError } from "../errors/app-error";
import { withTenant, type TenantContext, type Tx } from "../tenant";
import {
  compilePackage,
  originalPosition,
  packageCompileError,
} from "../components/compile";
import { handleSdkCall, permissionsSchema } from "../components/sdk";
import { parseIcon } from "./icon";

export { DEFAULT_PAGE_ICON, parseIcon, toIconName } from "./icon";
export type { PageFiles } from "../db/schema";

export const DEFAULT_ENTRY = "index.tsx";

const name = z.string().trim().min(1);
// Relative segment: not empty, not `.`/`..`, no exotic character.
const SEGMENT = /^[A-Za-z0-9_@-][A-Za-z0-9_.@-]*$/;

export function checkPath(path: string) {
  const ok =
    path.length <= 200 &&
    path.split("/").every((s) => SEGMENT.test(s) && s !== "." && s !== "..");
  if (!ok)
    throw appError("pages.invalidPath", "Invalid file path: {path}", { path });
  return path;
}

function checkFiles(files: PageFiles, entry: string) {
  for (const [p, src] of Object.entries(files)) {
    checkPath(p);
    if (typeof src !== "string")
      throw appError("pages.invalidFile", "Invalid file content: {path}", {
        path: p,
      });
  }
  if (!(entry in files))
    throw appError("pages.entryMissing", "Entry file not found: {entry}", {
      entry,
    });
}

export type FileOp =
  | { op: "write"; path: string; source: string }
  | { op: "edit"; path: string; old: string; new: string }
  | { op: "rename"; from: string; to: string }
  | { op: "delete"; path: string };

export type PageInput = {
  name: string;
  icon?: string;
  files: PageFiles;
  entry?: string;
  deps?: Record<string, string>;
  permissions?: Record<string, unknown>;
  publish?: boolean;
};

const res = (id: string) => ({ type: "page", id });
const inWs = (ctx: TenantContext, id: string) =>
  and(eq(pages.id, id), eq(pages.workspaceId, ctx.workspaceId));

async function load(tx: Tx, ctx: TenantContext, id: string) {
  const [p] = await tx.select().from(pages).where(inWs(ctx, id));
  return p ?? null;
}
type PageRow = NonNullable<Awaited<ReturnType<typeof load>>>;

async function version(tx: Tx, pageId: string, v: number) {
  const [row] = await tx
    .select()
    .from(pageVersions)
    .where(and(eq(pageVersions.pageId, pageId), eq(pageVersions.version, v)));
  return row ?? null;
}

// Pins the draft as a new published version.
async function publishRow(tx: Tx, ctx: TenantContext, p: PageRow) {
  const [last] = await tx
    .select({ version: pageVersions.version })
    .from(pageVersions)
    .where(eq(pageVersions.pageId, p.id))
    .orderBy(desc(pageVersions.version))
    .limit(1);
  const v = (last?.version ?? 0) + 1;
  await tx.insert(pageVersions).values({
    organizationId: ctx.organizationId,
    pageId: p.id,
    version: v,
    files: p.files,
    entry: p.entry,
    bundle: p.bundle,
    deps: p.deps,
    permissions: p.permissions,
  });
  const [row] = await tx
    .update(pages)
    .set({ currentVersion: v, hasDraft: false, updatedAt: new Date() })
    .where(inWs(ctx, p.id))
    .returning();
  await audit(tx, ctx, "page.publish", res(p.id), { version: v });
  return row!;
}

// Modifies the draft (files transformed by `edit`), never the published one.
async function editDraft(
  ctx: TenantContext,
  id: string,
  edit: (p: PageRow) => {
    files?: PageFiles;
    entry?: string;
    deps?: Record<string, string>;
    permissions?: Record<string, unknown>;
  },
  detail: Record<string, unknown>,
) {
  await requireScope(ctx, "write");
  return withTenant(ctx, async (tx) => {
    const p = await load(tx, ctx, id);
    if (!p) return null;
    const next = { ...p, ...edit(p) };
    checkFiles(next.files, next.entry);
    const [row] = await tx
      .update(pages)
      .set({
        files: next.files,
        entry: next.entry,
        deps: next.deps,
        permissions: next.permissions,
        // Sources changed: the compiled output is no longer up to date (13.2).
        bundle: null,
        hasDraft: true,
        updatedAt: new Date(),
      })
      .where(inWs(ctx, id))
      .returning();
    await audit(tx, ctx, "page.update", res(id), detail);
    return row!;
  });
}

function fileOf(p: PageRow, path: string) {
  if (!(path in p.files))
    throw appError("pages.fileNotFound", "File not found: {path}", { path });
  return p.files[path]!;
}

// Runtime errors: expired after 24 h, capped per page (loop
// of errors with all-different messages). The runtime names the bundle
// `runbase-page.js` (sourceURL): the first frame is remapped through sourcemap.
export const PAGE_ERROR_TTL_MS = 24 * 3600_000;
const MAX_PAGE_ERRORS = 200;
const FRAME = /runbase-page\.js:(\d+):(\d+)/;
const expiry = () => new Date(Date.now() - PAGE_ERROR_TTL_MS);
export type PageErrorInput = {
  draft?: boolean;
  message: string;
  stack?: string;
};

async function locate(p: { files: PageFiles; entry: string }, stack?: string) {
  const m = stack && FRAME.exec(stack);
  if (!m) return null;
  const r = await compilePackage(p.files, p.entry);
  const o = r.map && originalPosition(r.map, Number(m[1]), Number(m[2]));
  return o ? `${o.file}:${o.line}:${o.col}` : null;
}

// Metadata without sources or bundle (lists).
const meta = {
  id: pages.id,
  name: pages.name,
  icon: pages.icon,
  entry: pages.entry,
  hasDraft: pages.hasDraft,
  currentVersion: pages.currentVersion,
  createdAt: pages.createdAt,
  updatedAt: pages.updatedAt,
};

export const pagesService = {
  list: async (ctx: TenantContext) => {
    await requireScope(ctx, "read");
    return withTenant(ctx, (tx) =>
      tx
        .select(meta)
        .from(pages)
        .where(eq(pages.workspaceId, ctx.workspaceId))
        .orderBy(pages.createdAt),
    );
  },
  // Published version (null if never published); `draft`: the draft (write scope).
  get: async (
    ctx: TenantContext,
    id: string,
    opts: { draft?: boolean } = {},
  ) => {
    await requireScope(ctx, opts.draft ? "write" : "read");
    return withTenant(ctx, async (tx) => {
      const p = await load(tx, ctx, id);
      if (!p) return null;
      const { files, entry, bundle, deps, permissions, ...rest } = p;
      if (opts.draft)
        return {
          ...rest,
          version: null,
          files,
          entry,
          bundle,
          deps,
          permissions,
        };
      if (!p.currentVersion) return null;
      const v = (await version(tx, id, p.currentVersion))!;
      return {
        ...rest,
        version: v.version,
        files: v.files,
        entry: v.entry,
        bundle: v.bundle,
        deps: v.deps,
        permissions: v.permissions,
      };
    });
  },
  versions: async (ctx: TenantContext, id: string) => {
    await requireScope(ctx, "read");
    return withTenant(ctx, async (tx) => {
      if (!(await load(tx, ctx, id))) return [];
      return tx
        .select({
          version: pageVersions.version,
          entry: pageVersions.entry,
          createdAt: pageVersions.createdAt,
        })
        .from(pageVersions)
        .where(eq(pageVersions.pageId, id))
        .orderBy(pageVersions.version);
    });
  },
  create: async (ctx: TenantContext, input: PageInput) => {
    await requireScope(ctx, "write");
    const entry = input.entry ?? DEFAULT_ENTRY;
    checkFiles(input.files, entry);
    const icon = input.icon ? parseIcon(input.icon) : undefined;
    return withTenant(ctx, async (tx) => {
      const [p] = await tx
        .insert(pages)
        .values({
          organizationId: ctx.organizationId,
          workspaceId: ctx.workspaceId,
          name: name.parse(input.name),
          ...(icon && { icon }),
          files: input.files,
          entry,
          deps: input.deps ?? {},
          permissions: input.permissions ?? {},
        })
        .returning();
      await audit(tx, ctx, "page.create", res(p!.id), { name: input.name });
      return input.publish ? publishRow(tx, ctx, p!) : p!;
    });
  },
  // Name and icon apply immediately; files, entry, deps and permissions
  // modify the draft (`files` replaces the whole package).
  update: async (ctx: TenantContext, id: string, patch: Partial<PageInput>) => {
    await requireScope(ctx, "write");
    const icon = patch.icon ? parseIcon(patch.icon) : undefined;
    const draft =
      patch.files !== undefined ||
      patch.entry !== undefined ||
      patch.deps !== undefined ||
      patch.permissions !== undefined;
    if (draft) {
      const row = await editDraft(
        ctx,
        id,
        (p) => ({
          files: patch.files ?? p.files,
          entry: patch.entry ?? p.entry,
          deps: patch.deps ?? p.deps,
          permissions: patch.permissions ?? p.permissions,
        }),
        { entry: patch.entry },
      );
      if (!row) return null;
    }
    const row = await withTenant(ctx, async (tx) => {
      const p = await load(tx, ctx, id);
      if (!p) return null;
      if (!patch.name && !icon) return p;
      const [row] = await tx
        .update(pages)
        .set({
          ...(patch.name && { name: name.parse(patch.name) }),
          ...(icon && { icon }),
          updatedAt: new Date(),
        })
        .where(inWs(ctx, id))
        .returning();
      await audit(tx, ctx, "page.update", res(id), { name: patch.name, icon });
      return row!;
    });
    return row && patch.publish ? pagesService.publish(ctx, id) : row;
  },
  // Draft file patch, applied in order, all or nothing:
  // write, replace old -> new in a file, rename (the entry point
  // follows), delete (the entry point is refused: pages.entryMissing).
  patchFiles: (ctx: TenantContext, id: string, ops: FileOp[]) =>
    editDraft(
      ctx,
      id,
      (p) => {
        const files = { ...p.files };
        let entry = p.entry;
        for (const op of ops) {
          if (op.op === "write") files[checkPath(op.path)] = op.source;
          else if (op.op === "edit") {
            const src = fileOf({ ...p, files }, op.path);
            const at = src.indexOf(op.old);
            if (at < 0 || src.indexOf(op.old, at + 1) >= 0)
              throw appError(
                "pages.editNoMatch",
                "{path}: `old` must match exactly once",
                { path: op.path },
              );
            files[op.path] =
              src.slice(0, at) + op.new + src.slice(at + op.old.length);
          } else if (op.op === "rename") {
            const src = fileOf({ ...p, files }, op.from);
            delete files[op.from];
            files[checkPath(op.to)] = src;
            if (entry === op.from) entry = op.to;
          } else {
            fileOf({ ...p, files }, op.path);
            delete files[op.path];
          }
        }
        return { files, entry };
      },
      { ops: ops.map((o) => o.op) },
    ),
  publish: async (ctx: TenantContext, id: string) => {
    await requireScope(ctx, "write");
    return withTenant(ctx, async (tx) => {
      const p = await load(tx, ctx, id);
      if (!p) return null;
      return p.hasDraft ? publishRow(tx, ctx, p) : p;
    });
  },
  // Resets the draft to the published version (no effect if never published).
  discard: async (ctx: TenantContext, id: string) => {
    await requireScope(ctx, "write");
    return withTenant(ctx, async (tx) => {
      const p = await load(tx, ctx, id);
      if (!p || !p.currentVersion) return p;
      const v = (await version(tx, id, p.currentVersion))!;
      const [row] = await tx
        .update(pages)
        .set({
          files: v.files,
          entry: v.entry,
          bundle: v.bundle,
          deps: v.deps,
          permissions: v.permissions,
          hasDraft: false,
          updatedAt: new Date(),
        })
        .where(inWs(ctx, id))
        .returning();
      return row!;
    });
  },
  remove: async (ctx: TenantContext, id: string) => {
    await requireScope(ctx, "write");
    return withTenant(ctx, async (tx) => {
      const [row] = await tx.delete(pages).where(inWs(ctx, id)).returning();
      if (row) await audit(tx, ctx, "page.delete", res(id));
      return row !== undefined;
    });
  },
  // Restore = new published version taking the files of `v`
  // (any draft is discarded).
  restore: async (ctx: TenantContext, id: string, v: number) => {
    await requireScope(ctx, "write");
    return withTenant(ctx, async (tx) => {
      const p = await load(tx, ctx, id);
      const old = p && (await version(tx, id, v));
      if (!p || !old) return null;
      const row = await publishRow(tx, ctx, {
        ...p,
        files: old.files,
        entry: old.entry,
        bundle: old.bundle,
        deps: old.deps,
        permissions: old.permissions,
      });
      const [out] = await tx
        .update(pages)
        .set({
          files: old.files,
          entry: old.entry,
          bundle: old.bundle,
          deps: old.deps,
          permissions: old.permissions,
        })
        .where(inWs(ctx, id))
        .returning();
      await audit(tx, ctx, "page.restore", res(id), { version: v });
      return { ...row, ...out! };
    });
  },
  // Compiled package for the /p/[slug] iframe (published, or draft): bundle,
  // sources (Tailwind CSS on the app side) and readable objects (live).
  bundle: async (
    ctx: TenantContext,
    id: string,
    opts: { draft?: boolean } = {},
  ) => {
    const p = await pagesService.get(ctx, id, opts);
    if (!p) throw appError("pages.notFound", "Page not found: {id}", { id });
    const r = await compilePackage(p.files, p.entry);
    if (!r.bundle) throw packageCompileError(r.errors);
    const perms = permissionsSchema.parse(p.permissions ?? {});
    return {
      bundle: r.bundle,
      sources: Object.values(p.files),
      objects: perms.objects,
    };
  },
  // SDK call relayed from the iframe: permissions read from the page
  // package, never provided by the client.
  call: async (
    ctx: TenantContext,
    id: string,
    raw: unknown,
    opts: { draft?: boolean; user?: Record<string, unknown> | null } = {},
  ) => {
    const p = await pagesService.get(ctx, id, { draft: opts.draft });
    if (!p) throw appError("pages.notFound", "Page not found: {id}", { id });
    const perms = permissionsSchema.parse(p.permissions ?? {});
    return handleSdkCall(ctx, perms, raw, { user: opts.user, pageId: id });
  },
  // Runtime error reported by the iframe (deduplicated by fingerprint).
  reportError: async (
    ctx: TenantContext,
    id: string,
    input: PageErrorInput,
  ) => {
    const p = await pagesService.get(ctx, id, { draft: input.draft });
    if (!p) throw appError("pages.notFound", "Page not found: {id}", { id });
    const message = String(input.message).slice(0, 1_000);
    const stack = input.stack ? String(input.stack).slice(0, 4_000) : null;
    const location = await locate(p, input.stack);
    const fingerprint = createHash("sha1")
      .update(`${message}\n${location ?? ""}`)
      .digest("hex");
    const version = input.draft ? 0 : p.version!;
    const now = new Date();
    return withTenant(ctx, async (tx) => {
      await tx
        .delete(pageErrors)
        .where(
          and(eq(pageErrors.pageId, id), lt(pageErrors.lastSeen, expiry())),
        );
      const bump = {
        count: sql`${pageErrors.count} + 1`,
        lastSeen: now,
        stack,
      };
      const key = and(
        eq(pageErrors.pageId, id),
        eq(pageErrors.version, version),
        eq(pageErrors.fingerprint, fingerprint),
      );
      const [{ n }] = (await tx
        .select({ n: count() })
        .from(pageErrors)
        .where(eq(pageErrors.pageId, id))) as [{ n: number }];
      if (n >= MAX_PAGE_ERRORS) {
        const [row] = await tx
          .update(pageErrors)
          .set(bump)
          .where(key)
          .returning();
        return row ?? null;
      }
      const [row] = await tx
        .insert(pageErrors)
        .values({
          organizationId: ctx.organizationId,
          pageId: id,
          version,
          fingerprint,
          message,
          location,
          stack,
        })
        .onConflictDoUpdate({
          target: [
            pageErrors.pageId,
            pageErrors.version,
            pageErrors.fingerprint,
          ],
          set: bump,
        })
        .returning();
      return row!;
    });
  },
  // Recent errors (< 24 h) of the published version, or of the draft with `draft`.
  errors: async (
    ctx: TenantContext,
    id: string,
    opts: { draft?: boolean } = {},
  ) => {
    await requireScope(ctx, opts.draft ? "write" : "read");
    return withTenant(ctx, async (tx) => {
      const p = await load(tx, ctx, id);
      if (!p) throw appError("pages.notFound", "Page not found: {id}", { id });
      const version = opts.draft ? 0 : p.currentVersion;
      if (version === null) return [];
      return tx
        .select({
          message: pageErrors.message,
          location: pageErrors.location,
          stack: pageErrors.stack,
          count: pageErrors.count,
          version: pageErrors.version,
          firstSeen: pageErrors.firstSeen,
          lastSeen: pageErrors.lastSeen,
        })
        .from(pageErrors)
        .where(
          and(
            eq(pageErrors.pageId, id),
            eq(pageErrors.version, version),
            gt(pageErrors.lastSeen, expiry()),
          ),
        )
        .orderBy(desc(pageErrors.lastSeen))
        .limit(50);
    });
  },
};
