# Governance

Runbase is an open-source project led by MENTIONABLE SAS, the company that created it and holds its copyright. This document explains who decides what and how a contribution goes from an idea to a merged change.

## Model

Runbase follows a BDFL ("benevolent dictator for life") model. The project owner, MENTIONABLE SAS, acts through the maintainers listed in [MAINTAINERS.md](MAINTAINERS.md) and has the final say on every decision. We decide in the open: discussions, RFCs and the roadmap are public, and every decision of medium or large scope is written down with its reasons.

The model can change as the community grows. Any change to this document goes through an RFC.

## Roles

- **Contributor**: anyone who opens an issue, a discussion or a pull request.
- **Triager**: a regular contributor trusted to label, reproduce and close issues. Maintainers invite triagers.
- **Maintainer**: reviews and merges pull requests, triages issues and owns an area of the code. Maintainers are listed in [MAINTAINERS.md](MAINTAINERS.md) and are appointed by the project owner.

## How decisions are made

The process depends on the size of the change.

| Size   | Examples                                                                      | Process                                                                                                                                                                                         |
| ------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Small  | Bug fix, docs, typo, small UI fix, test                                       | Issue, then pull request, then green CI, then merge by a maintainer.                                                                                                                            |
| Medium | New block, new connector, new MCP tool, new setting                           | An issue labelled `roadmap` that a maintainer has placed in the **Planned** column of the [roadmap](ROADMAP.md).                                                                                |
| Large  | Data model, public API (HTTP, MCP, SDK), breaking change, license, governance | An RFC in [GitHub Discussions](https://github.com/getrunbase/runbase/discussions/categories/rfc), open for at least 7 days. The maintainers then decide and post the decision with its reasons. |

When in doubt about the size of a change, open an issue and ask.

### Pull requests from external contributors

- **Bugs, docs and tests**: open a pull request at any time. Link the issue when there is one.
- **Features** (new behavior, medium or large changes): open a pull request only for an issue labelled `status: accepted`. Pull requests for features without an accepted issue may be closed, however good they are, because a feature is a long-term maintenance commitment.

Ideas start in [Discussions, Ideas category](https://github.com/getrunbase/runbase/discussions/categories/ideas). A maintainer turns an idea into an issue and labels it `status: accepted` when the project wants it.

### RFCs

Open an RFC with the RFC discussion form. It states the problem, the proposal, the alternatives, the impact on existing users and data, and the open questions. Anyone can comment. After at least 7 days, a maintainer posts the decision: accepted, rejected or needs changes. An accepted RFC becomes one or more issues labelled `status: accepted`.

## Response times

We aim to triage new issues within 3 working days and to give a first review on pull requests within 5 working days. These are goals, not guarantees.

## Contributor License Agreement

Every contributor signs the [CLA](CLA.md) once. It lets MENTIONABLE SAS distribute Runbase under its current license (AGPL-3.0-only for the core, see [LICENSE](LICENSE)) and under commercial terms.

## Code of conduct

Everyone in the project follows the [Code of Conduct](CODE_OF_CONDUCT.md). Maintainers enforce it.
