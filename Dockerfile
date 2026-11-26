# syntax=docker/dockerfile:1
# Single multi-stage image for the monorepo: targets `web`, `worker`, `sandbox`, `renderer` and `docs`.
FROM node:22-alpine AS base
WORKDIR /app
COPY package.json ./
# pnpm installed outside /root so the `node` user of the final targets can read it.
ENV COREPACK_HOME=/usr/local/share/corepack
# `pnpm --version` downloads at build time the native binary pnpm 12 would fetch at runtime.
RUN corepack enable && corepack install && pnpm --version && chmod -R a+rX "$COREPACK_HOME"

FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY apps/renderer/package.json apps/renderer/
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/
COPY packages/node-sdk/package.json packages/node-sdk/
COPY packages/sdk/package.json packages/sdk/
COPY packages/kit/package.json packages/kit/
COPY connectors/slack/package.json connectors/slack/
COPY connectors/google/package.json connectors/google/
COPY connectors/google-calendar/package.json connectors/google-calendar/
COPY connectors/google-drive/package.json connectors/google-drive/
COPY connectors/google-sheets/package.json connectors/google-sheets/
COPY connectors/gmail/package.json connectors/gmail/

# Runtime sources of the tsx apps (no build step): only what they import or
# read through fs at runtime (core SQL migrations in packages/core/drizzle,
# catalog in templates/ and authors/, connectors/).
FROM scratch AS app-source
COPY package.json pnpm-workspace.yaml tsconfig.base.json /app/
COPY packages /app/packages
COPY connectors /app/connectors
COPY templates /app/templates
COPY authors /app/authors

# Worker and sandbox: production dependencies of @getrunbase/worker and its
# workspace packages only (tsx is a production dependency: the apps run from source).
FROM manifests AS worker-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store,sharing=locked pnpm install --frozen-lockfile --prod --store-dir /pnpm/store --filter "@getrunbase/worker..." --filter "./connectors/*"
COPY --from=app-source /app ./
COPY apps/worker apps/worker
# Chromium and playwright live in the renderer only.
RUN if ls node_modules/.pnpm | grep -qE '^(playwright|@playwright)'; then \
      echo "playwright must not be in the worker image" && exit 1; fi

# Renderer: production dependencies of @getrunbase/renderer only.
FROM manifests AS renderer-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store,sharing=locked pnpm install --frozen-lockfile --prod --store-dir /pnpm/store --filter "@getrunbase/renderer..."
COPY --from=app-source /app ./
COPY apps/renderer apps/renderer

# Web: only its own dependencies (and the core's). Chromium and
# playwright live in the renderer; the build fails if they come back
# into the web image. playwright-core (E2E devDependency, no browser) is tolerated.
FROM manifests AS web-build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store,sharing=locked pnpm install --frozen-lockfile --store-dir /pnpm/store --filter "@getrunbase/web..."
COPY . .
RUN if ls node_modules/.pnpm | grep -qE '^(playwright@|@playwright)'; then \
      echo "playwright must not be in the web image" && exit 1; fi
# Dedicated origin for the code components runtime, fixed at build time (empty = same
# origin as the app, still in a sandboxed iframe).
ARG NEXT_PUBLIC_RUNTIME_ORIGIN=""
ENV NEXT_PUBLIC_RUNTIME_ORIGIN=$NEXT_PUBLIC_RUNTIME_ORIGIN
RUN pnpm --filter @getrunbase/web build
# Public catalog index, read by /api/v1/catalog through CATALOG_INDEX;
# the build fails if the catalog is invalid.
RUN pnpm catalog:validate --out /app/catalog-index.json

# Web runtime tree: production dependencies only (next start needs no
# devDependencies; an in-place prune leaves orphans in node_modules/.pnpm),
# the sources and the build output without .next/cache.
FROM manifests AS web-runtime
RUN --mount=type=cache,id=pnpm,target=/pnpm/store,sharing=locked pnpm install --frozen-lockfile --prod --store-dir /pnpm/store --filter "@getrunbase/web..." --filter "./connectors/*"
# Stricter than the build stage: not even playwright-core in the web image.
RUN if ls node_modules/.pnpm | grep -qE '^(playwright|@playwright)'; then \
      echo "playwright must not be in the web image" && exit 1; fi
COPY --from=app-source /app ./
COPY apps/web apps/web
COPY --from=web-build /app/catalog-index.json ./
COPY --from=web-build --exclude=cache /app/apps/web/.next apps/web/.next

# Deno (pinned version, keep in sync with ci.yml) for the function sandbox runtime.
# glibc binary: the official alpine image ships the glibc libs, isolated in
# /usr/local/lib/glibc and resolved through ld.so.cache (no effect on musl/node).
FROM denoland/deno:alpine-2.9.8 AS deno

# Shared by web, worker and sandbox: one Deno layer reused in the registry.
FROM base AS base-deno
COPY --from=deno /usr/local/lib/glibc /usr/local/lib/glibc
COPY --from=deno /lib64 /lib64
COPY --from=deno /lib/ld-linux-* /lib/
COPY --from=deno /etc/ld.so.conf /etc/ld.so.cache /etc/
COPY --from=deno /bin/deno /usr/local/bin/deno
ENV DENO_BIN=/usr/local/bin/deno DENO_DIR=/tmp/deno-dir
RUN deno --version

# Deno (base-deno): test rendering of code components, same sandbox as functions.
FROM base-deno AS web
ENV NODE_ENV=production
# Commit SHA (logs), provided by CI.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
# Non-root: `node` owns /app (the .next cache is written at runtime).
COPY --chown=node:node --from=web-runtime /app ./
# Mount point of the files-data volume: a fresh volume inherits this owner.
RUN mkdir -p /data/files && chown node:node /data/files
ENV CATALOG_INDEX=/app/catalog-index.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD wget -q --spider http://127.0.0.1:3000/api/health || exit 1
CMD ["pnpm", "--filter", "@getrunbase/web", "start"]

FROM base-deno AS worker
ENV NODE_ENV=production
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
COPY --chown=node:node --from=worker-deps /app ./
RUN mkdir -p /data/files && chown node:node /data/files
USER node
# Board and /healthz liveness probe on BOARD_PORT (default 7101).
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=5 \
  CMD wget -q --spider "http://127.0.0.1:${BOARD_PORT:-7101}/healthz" || exit 1
# Migrations: `migrate` service (same image), run before the rollout, never at startup.
CMD ["pnpm", "--filter", "@getrunbase/worker", "start"]

# Sandbox service: runs functions for web and worker (SANDBOX_URL).
# Non-root `node` user, read-only FS in compose (tmpfs /tmp), no infra
# variables in its env.
FROM base-deno AS sandbox
ENV NODE_ENV=production
ENV HOME=/tmp
COPY --from=worker-deps /app ./
USER node
WORKDIR /app/apps/worker
EXPOSE 7200
CMD ["node", "--import", "tsx", "src/sandbox.ts"]

# Renderer: headless Chromium for page.screenshot,
# components.test { screenshot } and axe audits, behind the `render` queue.
FROM base AS renderer
ENV NODE_ENV=production
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
RUN apk add --no-cache chromium nss freetype harfbuzz ttf-freefont font-noto
ENV PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium
COPY --chown=node:node --from=renderer-deps /app ./
RUN mkdir -p /data/files && chown node:node /data/files
USER node
EXPOSE 7102
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD wget -qO- http://127.0.0.1:7102/health > /dev/null || exit 1
CMD ["pnpm", "--filter", "@getrunbase/renderer", "start"]

# Public documentation site (apps/docs), served under /docs of the main domain:
# assets requested at /docs/_next, the reverse proxy strips /docs before forwarding them.
FROM manifests AS docs-build
COPY apps/docs/package.json apps/docs/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store,sharing=locked pnpm install --frozen-lockfile --store-dir /pnpm/store --filter "@getrunbase/docs..."
COPY apps/docs apps/docs
ARG DOCS_ASSET_PREFIX=/docs
ENV DOCS_ASSET_PREFIX=$DOCS_ASSET_PREFIX
RUN pnpm --filter @getrunbase/docs build

FROM base AS docs
ENV NODE_ENV=production
COPY --chown=node:node --from=docs-build /app ./
USER node
EXPOSE 7300
# DOCS_SITE_URL (canonical URLs, sitemap) is read at runtime.
CMD ["pnpm", "--filter", "@getrunbase/docs", "start"]
