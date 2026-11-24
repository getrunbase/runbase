# Contributing to Runbase

Thanks for your interest in contributing! This guide explains how to set up the project, run the checks, and follow the rules every change must respect.

By participating, you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md). To report a security issue, do **not** open a public issue: see [SECURITY.md](SECURITY.md).

## Contributor License Agreement

Before we can merge your first pull request, you must sign the [CLA](CLA.md). The CLA Assistant bot comments on your pull request: reply with the sentence it gives you. You sign once, for all your future contributions.

## Development setup

Requirements:

- Node.js 22+
- [pnpm](https://pnpm.io) (the version is pinned in `package.json`; run `corepack enable` to use it)
- Docker (Postgres 17 and Redis 7)
- [Deno](https://deno.com) 2.x, used to run user functions in a sandbox

Fastest path: `pnpm install && pnpm bootstrap you@example.com` checks the tools, writes `.env` with fresh secrets, starts Postgres and Redis, applies the migrations and creates your admin account. Then run `pnpm dev`.

Step by step:

```sh
pnpm install
cp .env.example .env          # then fill in the two secrets below
docker compose up -d           # infra only (Postgres, Redis), no image build
pnpm db:migrate
pnpm dev                       # web app, worker and renderer (docs: pnpm dev:docs)
```

`.env.example` leaves two secrets empty: generate them before the first start.

```sh
openssl rand -base64 32       # paste as BETTER_AUTH_SECRET
openssl rand -base64 32       # paste as SECRETS_MASTER_KEY (32 bytes, base64)
```

`SECRETS_MASTER_KEY` encrypts the secrets vault. Keep the same value for your local database: a new key makes the stored secrets unreadable.

To run the full stack in containers instead (builds the images, slower):

```sh
docker compose --profile app up -d --build
```

Create the first owner account with `pnpm admin:create <email> [name]`.

## Checks

Every pull request must pass the same checks as CI:

```sh
pnpm lint        # ESLint, including the UI and i18n rules below
pnpm typecheck   # TypeScript, all packages
pnpm test        # unit and integration tests (needs Postgres and Redis running)
```

Tests run against a real database: do not mock Postgres or Redis.

### When to write a test

- **Yes**: non-trivial logic (a branch, a loop, a parser, permissions, money, data writes) and every bug fix (one test that fails without the fix).
- **No**: pure UI, simple wiring, renames, copy changes. Do not duplicate in an MCP route test what the `packages/core` service test already covers.
- One focused test per behavior is enough. Extend an existing test file before creating a new one.

### Running tests locally

Run only the tests for what you touch; CI runs the full suite on every pull request.

```sh
cd packages/core
node --env-file-if-exists=../../.env --import tsx --import ./src/test-setup.ts --test src/records/records.test.ts
# add --test-name-pattern="<name>" to run a single test
```

End-to-end tests (`pnpm --filter @getrunbase/web test:e2e`) are slow and optional locally.

CI also runs [gitleaks](https://github.com/gitleaks/gitleaks) to block committed secrets. Never commit a `.env` file or a real key.

## Project rules

- **UI**: use only [shadcn/ui](https://ui.shadcn.com) components and Tailwind. No other component library (MUI, Chakra, Mantine, antd…). Radix may only be imported inside `components/ui` (the shadcn components). `pnpm lint` enforces this.
- **Core**: no business logic and no templates in the core.
- **Data access**: the web app (`apps/web`) and the MCP server go through the services of `packages/core`.
- **i18n**: the whole UI exists in English and French ([next-intl](https://next-intl.dev)). No hard-coded visible text: every new string goes into `apps/web/messages/en/<ns>.json` **and** `apps/web/messages/fr/<ns>.json`, in the same commit. Format dates and numbers with `useFormatter` / `getFormatter`. Full rules: [`docs/i18n.md`](docs/i18n.md). Lint, typecheck and the key-parity test enforce this.
- **Core and MCP are English only**: no French text in `packages/core`, `apps/web/app/api/mcp/**` or `apps/worker`. French only lives in `apps/web/messages/fr/**`. Every user-facing error is an `appError("domain.camelName", "English template {param}", { param })` (from `@getrunbase/core/errors`), with its translation in `apps/web/messages/fr/errors/<data|automation|interfaces|platform>.json`. The web app displays it with `useErrorText` / `getErrorText`; server actions return `actionError(e)`. The `lib/error-codes.test.ts` test enforces this.

## Pull requests

- Branch from `main` and keep each pull request focused on one change.
- Use [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `docs:`, `ci:`…).
- Fill in the pull request template and link the related issue.
- Make sure `pnpm lint`, `pnpm typecheck` and the tests for the code you changed pass locally. CI runs the full `pnpm test`.

## Submitting a template

Community templates feed the public catalog (one page per template and per creator). Publishing is free: there are no paid templates.

A template is a folder `templates/<slug>/` with three files:

- `template.json`: `id`, `slug` (the folder name), `name`, `categories`, `authorId` (your GitHub login), `createdAt`, `updatedAt`. Connectors are never listed by hand: they are derived from the manifest.
- `README.md`: the description, at least 300 words, with the sections `## Who it's for`, `## The problem`, `## What it does` and `## Setup`.
- `runbase-template.json`: the manifest, exported with the MCP tool `template.export` (see [`templates/README.md`](templates/README.md)). Secret values never appear.

With your first template, add your creator profile `authors/<github-username>.json`: `username` (GitHub login), `name`, `bio`, `avatar`, `links`.

Three ways to submit:

1. **Pull request** on `templates/`, and tick the "Submitting a template" checklist of the [pull request template](.github/PULL_REQUEST_TEMPLATE.md).
2. **MCP tool `templates.submit`**: it validates the template and opens the pull request for you.
3. **Issue** [Submit a template](../../issues/new?template=submit_template.yml), if you prefer to share the files.

Review process:

1. **Automatic validation**: `pnpm catalog:validate` (CI job `Catalog`) checks the author profile, the description length and sections, and the manifest. Fix every reported error.
2. **Human review** by a maintainer: the template works on a fresh workspace, the description is accurate and useful, there is no secret, personal or customer data, and the setup steps are complete.
3. **Publication**: on merge, the `Catalog publish` CI job sends a signed webhook that refreshes the catalog pages, including your creator page `/creators/<github-username>`.

## Reporting bugs and requesting features

Use the [issue templates](../../issues/new/choose): bug report, feature request, or connector request.

## Governance and accepted issues

How decisions are made is described in [GOVERNANCE.md](GOVERNANCE.md). In short:

- **Bugs, docs and tests**: open a pull request at any time.
- **Features**: open a pull request only for an issue labelled `status: accepted`. New ideas start in [Discussions, Ideas](https://github.com/getrunbase/runbase/discussions/categories/ideas).
- **Large changes** (data model, public API, breaking changes): open an RFC in [Discussions, RFC](https://github.com/getrunbase/runbase/discussions/categories/rfc) first.
- Pull request titles follow Conventional Commits: they become the squash-merge commit and the changelog entry.

See also [SUPPORT.md](SUPPORT.md), [ROADMAP.md](ROADMAP.md) and [MAINTAINERS.md](MAINTAINERS.md).
