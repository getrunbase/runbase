# Self-hosting

Run Runbase on your own server with Docker, using prebuilt images. Target:
a working instance in under 5 minutes.

## Requirements

- Docker Engine 24+ with the Compose plugin (`docker compose version`).
- `openssl` (used by `setup.sh` to generate secrets).
- 2 GB of RAM. Images exist for `linux/amd64` and `linux/arm64`.

## Quick start

```sh
git clone https://github.com/getrunbase/runbase runbase && cd runbase
./setup.sh https://runbase.example.com   # or ./setup.sh for http://localhost:3000
docker compose -f docker-compose.selfhost.yml up -d --wait
docker compose -f docker-compose.selfhost.yml exec worker pnpm admin:create you@example.com
```

Open `<your URL>/login` and ask for a sign-in link. Without email settings
the link is not sent: it is printed in the web logs.

```sh
docker compose -f docker-compose.selfhost.yml logs web | grep email:console
```

`setup.sh` copies `.env.example` to `.env` (mode 600) and generates
`BETTER_AUTH_SECRET`, `SECRETS_MASTER_KEY`, `POSTGRES_PASSWORD`,
`QUERY_DB_PASSWORD`, `REDIS_PASSWORD` and `SANDBOX_TOKEN`. It never overwrites an existing
`.env` (`--force` regenerates everything, which makes stored secrets
unreadable). The compose file refuses to start while a secret is missing.

## What runs

| Service    | Role                                                                        | Network                   |
| ---------- | --------------------------------------------------------------------------- | ------------------------- |
| `postgres` | Database (volume `postgres-data`)                                           | internal                  |
| `redis`    | Queues and pub/sub, password protected (volume `redis-data`)                | internal                  |
| `migrate`  | One-shot: applies database migrations before the apps start                 | internal                  |
| `worker`   | Runs workflows, triggers and schedules                                      | internal, egress, sandbox |
| `web`      | Next.js app, port 3000 in the container                                     | internal, egress, sandbox |
| `sandbox`  | Runs function code (Deno), non-root, read-only, no database or Redis access | sandbox, sandbox-egress   |
| `renderer` | Headless Chromium for page screenshots and accessibility audits             | internal                  |

The `internal` network has no internet access and no published port: only the
web app is reachable from the host, on `127.0.0.1:${WEB_PORT}` by default.
Uploaded files are stored on local disk in the `files-data` volume, shared by
web, worker and renderer. The `sandbox` service reaches the internet through
`sandbox-egress` but never the `internal` network.

## Configuration

Every setting is documented in `.env.example`, required values first. The most
common optional ones:

- **Email.** Resend (`RESEND_API_KEY`) or any SMTP server (`SMTP_HOST`,
  `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`). `EMAIL_FROM` is
  required as soon as a provider is configured. With neither, emails are
  printed in the web logs (console mode).
- **Sign-in method.** `AUTH_METHOD=magic-link` (default): passwordless link
  sent by email. `AUTH_METHOD=password`: email and password (8 characters
  minimum), with a sign-up page at `/signup` and a password reset by email at
  `/reset-password` when Resend or SMTP is configured. Read at runtime: restart
  the `web` container, no rebuild. Accounts created without a password
  (invitations, magic link) set one through the reset link.
- **Sign-ups.** Closed by default; set `SIGNUPS_ENABLED=true` to open them, or
  create accounts with `pnpm admin:create` as above.
- **AI blocks.** No platform key: each workspace adds its own provider key as a secret (Settings › Secrets), and every AI block and page names the provider, model and secret it uses.
- **Code component runtime.** `NEXT_PUBLIC_RUNTIME_ORIGIN` serves the
  sandboxed iframe of code components from a second domain pointing to the same
  web container (e.g. `https://runtime.example.com`). It is baked in at build
  time: the published image ships with it empty (same origin, the iframe stays
  sandboxed). To use a dedicated origin, build the web image with
  `docker build --build-arg NEXT_PUBLIC_RUNTIME_ORIGIN=https://runtime.example.com .`
  and rebuild whenever it changes.
- **Version.** `RUNBASE_VERSION` pins an image tag (default `latest`).

Apply a change with `docker compose -f docker-compose.selfhost.yml up -d`.

### Anonymous telemetry

Anonymous telemetry is on by default. The worker sends one ping per day to
the project's receiver, so the project can measure self-hosted adoption.
`RUNBASE_TELEMETRY_URL` points it to another receiver. The worker logs on
start whether telemetry is on and how to turn it off.

Fields sent, as a JSON `POST`, and nothing else:

| Field        | Example        | Meaning                                                                                            |
| ------------ | -------------- | -------------------------------------------------------------------------------------------------- |
| `instanceId` | `5b0c…-…`      | Random UUID drawn on first start, stored in Redis. Not derived from any host, user or tenant data. |
| `version`    | `1.4.0`        | `APP_VERSION` of the image (`dev` if unset).                                                       |
| `os`, `arch` | `linux`, `x64` | Platform of the worker process.                                                                    |
| `node`       | `22.11.0`      | Node.js version.                                                                                   |
| `workspaces` | `<10`          | Number of workspaces, as a bucket (`0`, `<10`, `<100`, `<1000`, `<10000`, `<100000`, `100000+`).   |
| `workflows`  | `<100`         | Number of workflows, same buckets.                                                                 |
| `runs`       | `<10000`       | Number of workflow runs kept, same buckets.                                                        |

No personal data, no names, emails, IP-derived data or tenant content. A
failed ping (network, receiver down) is ignored and never affects the app.

**Opt out:** set `RUNBASE_TELEMETRY=0` in `.env`, then apply the change. The
worker then sends no request at all.

## Reverse proxy (HTTPS)

Keep `WEB_BIND=127.0.0.1` (default) and put a reverse proxy in front.
`BETTER_AUTH_URL` must be the public https URL.

Caddy (automatic certificates):

```caddyfile
runbase.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

nginx:

```nginx
server {
  listen 443 ssl;
  server_name runbase.example.com;
  # ssl_certificate ... (certbot)
  client_max_body_size 20m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_buffering off;   # streamed responses
  }
}
```

## Backups

Back up three things:

1. **`.env`**, above all `SECRETS_MASTER_KEY`: without it, the secrets stored
   in the database cannot be decrypted.
2. **The database**:

   ```sh
   docker compose -f docker-compose.selfhost.yml exec -T postgres \
     sh -c 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > runbase-$(date +%F).dump
   ```

3. **Uploaded files** (`files-data` volume):

   ```sh
   docker run --rm -v runbase_files-data:/data -v "$PWD":/out alpine \
     tar czf /out/files-$(date +%F).tgz -C /data .
   ```

   The volume name is prefixed by the compose project name (the directory
   name by default): check it with `docker volume ls`.

Restore a database dump into a fresh stack:

```sh
docker compose -f docker-compose.selfhost.yml stop web worker
docker compose -f docker-compose.selfhost.yml exec -T postgres \
  sh -c 'pg_restore --clean --if-exists -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < runbase-YYYY-MM-DD.dump
docker compose -f docker-compose.selfhost.yml up -d
```

Redis holds queues and transient state only; the database is the source of truth.

## Hardening

What the stack already does:

- Postgres and Redis sit on an internal network with no host port; Redis
  requires a password.
- The `web`, `worker`, `renderer` and `sandbox` images run as the non-root
  `node` user (uid 1000). The `files-perms` one-shot gives back to `node` the
  files of a `files-data` volume created by an older image that ran as root.
- Function code runs in the `sandbox` service: read-only filesystem, no
  capabilities, no access to Postgres or Redis, private address ranges denied.

On the host, we recommend:

- SSH with keys only (`PasswordAuthentication no`, `PermitRootLogin no`),
  fail2ban, automatic security updates.
- A firewall that only allows SSH, 80 and 443. Docker bypasses `ufw` for
  published ports: publish only the reverse proxy (keep `WEB_BIND=127.0.0.1`).
- Docker log rotation in `/etc/docker/daemon.json`
  (`"log-opts": {"max-size": "10m", "max-file": "3"}`) and `"live-restore": true`.
- To also filter the sandbox at the network level, add `DOCKER-USER` iptables
  rules that drop traffic from the `sandbox-egress` bridge to private ranges
  (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, 100.64/10, fc00::/7,
  fe80::/10) and to the host's public IP.
- For point-in-time recovery beyond nightly dumps, archive the Postgres WAL to
  object storage with a tool such as wal-g or pgBackRest, and test a restore
  regularly.

## Updates

```sh
git pull                                   # compose file and .env.example changes
docker compose -f docker-compose.selfhost.yml pull
docker compose -f docker-compose.selfhost.yml up -d --wait
```

The `migrate` service applies database migrations before the worker and the
web app start.
Back up the database first. To stay on a given release, set
`RUNBASE_VERSION` in `.env`; to roll back, set the previous tag and restore
the backup taken before the update.

## Troubleshooting

- `required variable ... is missing a value: run ./setup.sh`: `.env` is
  missing a secret; run `./setup.sh` (or add the value).
- `docker compose -f docker-compose.selfhost.yml ps` shows each service's
  health; `logs worker` shows migration errors.
- `EMAIL_FROM is required when an email provider (...) is configured`: set
  `EMAIL_FROM` to a sender verified by your provider.
