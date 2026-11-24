# Contributing guide for humans and AI agents

This file is the single source of project rules for every contributor, human or AI coding agent. `CLAUDE.md` only imports it.

## Architecture rules

- **UI**: use `@runbase/ui` (the design system's shadcn/ui components) and Tailwind with theme tokens only. Do not add any other component library (MUI, Chakra, Mantine, antd, ...). Import components provided by `@runbase/ui` from `@runbase/ui/components/ui/*`, not from `@/components/ui`. Radix is imported only inside `components/ui` (shadcn components).
- **Colours**: use only the tokens from `@runbase/ui/theme.css`. Never hardcode hex/rgb/hsl/oklch values or use arbitrary classes (`bg-[#...]`) outside `packages/ui`. `pnpm lint` (`no-restricted-imports`, `no-restricted-syntax`) enforces the UI and colour rules.
- **Core**: no business logic and no templates in the core.
- **Data access**: the front end (`apps/web`) and the MCP server access data through the services of `packages/core`.
- **i18n**: the whole UI exists in English and French (next-intl). No hardcoded visible text: every new string goes into `apps/web/messages/en/<ns>.json` **and** `apps/web/messages/fr/<ns>.json` in the same commit. Format dates and numbers with `useFormatter`/`getFormatter`. Full rules: `docs/i18n.md`. `pnpm lint`, `pnpm typecheck` and the key-parity test enforce this.
- **English-only core, MCP and worker**: no French text in `packages/core`, `apps/web/app/api/mcp/**` or `apps/worker`. French exists only in `apps/web/messages/fr/**`.
- **Errors**: every user-facing error is `appError("domain.camelName", "English template {param}", { param })` (from `@runbase/core/errors`), translated in `apps/web/messages/fr/errors/<data|automation|interfaces|platform>.json`. The web app displays it with `useErrorText`/`getErrorText`; server actions return `actionError(e)`. The test `lib/error-codes.test.ts` enforces this.
- **Comments**: code comments are written in English.

## Conventions

- Commits follow [Conventional Commits](https://www.conventionalcommits.org/), written in English (`feat(web): ...`, `fix(core): ...`).
- Keep pull requests small and focused on one change.
- Add tests for new logic and for bug fixes.

## Before you push

```sh
pnpm lint
pnpm typecheck
pnpm test
```

All three must pass.
