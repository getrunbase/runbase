# Security Policy

## Supported versions

Runbase is released from the `main` branch. Security fixes go into the latest
release and are not backported.

| Version | Supported |
| --- | --- |
| Latest release (`0.x`, newest minor) | Yes |
| Older `0.x` releases | No, upgrade to the latest release |
| Unreleased commits on `main` | Best effort |

Self-hosters should pin an image tag and upgrade when an advisory is published.
Subscribe to the repository's releases and security advisories (**Watch** >
**Custom** > **Releases** and **Security alerts**) to be notified.

## Reporting a vulnerability

Please **do not** report security vulnerabilities through public issues,
discussions or pull requests.

Report them privately through GitHub Security Advisories: open the repository's
**Security** tab, then click **Report a vulnerability** (or go to
`/security/advisories/new` on this repository). The report is visible only to
you and the maintainers.

Please include:

- the type of issue (for example SQL injection, sandbox escape, authentication
  bypass, tenant isolation breach);
- the affected files, routes or MCP tools, and the version, image tag or commit;
- step-by-step instructions to reproduce it, or a proof of concept;
- the impact, as you understand it.

Use your own self-hosted instance for testing. Do not access, change or delete
data that does not belong to you, and do not run denial of service tests.

## Response targets

These are targets, not guarantees, for a small maintainer team:

| Step | Target |
| --- | --- |
| Acknowledge the report | 3 business days |
| First assessment (confirmed or not, severity) | 7 days |
| Fix released for critical and high severity | 30 days |
| Fix released for medium and low severity | 90 days |

We keep you informed in the advisory while we investigate and fix the issue.
Once the fix is released, we publish the advisory (with a CVE when relevant)
and credit you, unless you prefer to stay anonymous.

Please give us reasonable time to fix the issue before any public disclosure.
If the targets above are missed, tell us in the advisory before disclosing.

## Scope

In scope:

- the code in this repository: the web app, the MCP server, the REST API, the
  worker, the function sandbox, the renderer and the `packages/*` libraries;
- the official Docker images and `docker-compose.selfhost.yml` with its default
  settings;
- tenant isolation (workspaces, row-level security, the read-only SQL console),
  sandbox escapes from functions or code components, authentication and
  authorization bypasses, secret leaks.

Out of scope:

- vulnerabilities in third-party dependencies with no exploitable impact on
  Runbase (report them upstream);
- instances with a modified configuration that weakens the defaults (for
  example `FUNCTIONS_ALLOW_PRIVATE_NETWORK=1` or a publicly exposed Postgres);
- connectors and templates published by third parties outside this repository;
- missing hardening headers or best practices without a demonstrated impact;
- social engineering, physical attacks and denial of service through traffic
  volume.
