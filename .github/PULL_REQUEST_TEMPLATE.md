## Summary

<!-- What does this pull request change, and why? -->

Closes #

## Type of change

- [ ] Bug fix
- [ ] Feature (linked issue labelled `status: accepted`)
- [ ] Docs
- [ ] Connector or template
- [ ] Refactor, chore or CI

## How to test

<!-- Steps a reviewer can follow to check the change. -->

## Screenshots

<!-- UI changes: before and after, light and dark mode. Delete otherwise. -->

## Checklist

- [ ] The pull request links an issue (features need an issue labelled `status: accepted`, see [GOVERNANCE.md](https://github.com/getrunbase/runbase/blob/main/GOVERNANCE.md))
- [ ] The title follows [Conventional Commits](https://www.conventionalcommits.org/) (`feat(web): ...`, `fix(core): ...`)
- [ ] Tests added or updated for the changed behavior
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass locally
- [ ] Every new visible text is in `apps/web/messages/en` **and** `apps/web/messages/fr`
- [ ] UI follows [AGENTS.md](https://github.com/getrunbase/runbase/blob/main/AGENTS.md): `@getrunbase/ui` components and theme tokens only
- [ ] No French text in `packages/core`, `apps/worker` or the MCP server; user-facing errors use `appError`
- [ ] Database migration, breaking change or docs update called out above, if any
- [ ] No secrets, personal data or customer data committed
- [ ] I have read [CONTRIBUTING.md](https://github.com/getrunbase/runbase/blob/main/CONTRIBUTING.md) and signed the [CLA](https://github.com/getrunbase/runbase/blob/main/CLA.md)

<details>
<summary>Submitting a template? Also check these.</summary>

- [ ] `templates/<slug>/template.json`, `README.md` (at least 300 words) and `runbase-template.json` (exported with `template.export`)
- [ ] `authors/<github-username>.json` (first template only)
- [ ] `pnpm catalog:validate` passes locally
- [ ] Connectors are not listed by hand: they are derived from the manifest
- [ ] I agree to publish the template under the MIT license of `templates/`

</details>
