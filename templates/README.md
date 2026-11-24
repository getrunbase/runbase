# Runbase templates

Community templates for Runbase, licensed under MIT (see `LICENSE`).
Each template lives in its own folder: `templates/<name>/runbase-template.json`
plus a `README.md`.

## Format: `runbase-template.json` (version 1)

| Key                   | Content                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `format`, `version`   | `"runbase-template"`, `1`                                                                |
| `name`, `description` | Display name and summary                                                                 |
| `databases`           | `{ slug, name }`                                                                         |
| `objects`             | `{ slug, name, icon?, database?, fields }` (typed fields, relations by slug)             |
| `views`               | Saved views: `{ object, name, filter?, sort?, columns? }`                                |
| `functions`           | Sandboxed JS functions: `{ name, code, inputSchema, outputSchema, permissions, limits }` |
| `components`          | TSX code components used by pages: `{ name, source, propsSchema, permissions }`          |
| `workflows`           | `{ key, name, definition }`, imported as drafts                                          |
| `pages`               | `{ name, icon?, definition }`                                                            |
| `secrets`             | NAMES of the required secrets, never their values                                        |
| `records`             | Optional sample records: `{ key, object, externalId?, data }`                            |

Workspace ids never appear. They are replaced by local references, resolved on
import: `$object:<slug>`, `$workflow:<key>`, `$record:<key>`.

The validator lives in `packages/core/src/templates/format.ts`.

## Export and import

- MCP: `template.export` (optionally `sampleRecords`) and `template.import`.
- App: Databases page, **Import template** button.

Import is refused when an object, function or component of the same name
already exists. Workflows are created as drafts: set the secrets listed in
`missingSecrets`, then activate them.
