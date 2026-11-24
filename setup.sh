#!/bin/sh
# Writes .env for docker-compose.selfhost.yml with strong random secrets.
#   ./setup.sh [public-url]        e.g. ./setup.sh https://runbase.example.com
#   ./setup.sh --force [public-url]  overwrite an existing .env
set -eu
cd "$(dirname "$0")"

force=0
if [ "${1:-}" = "--force" ]; then force=1; shift; fi
port="${WEB_PORT:-3000}"
url="${1:-http://localhost:$port}"

if [ -f .env ] && [ "$force" -ne 1 ]; then
  echo ".env already exists: keep it, or rerun with --force to regenerate every secret." >&2
  echo "Regenerating SECRETS_MASTER_KEY makes stored secrets unreadable." >&2
  exit 1
fi
command -v openssl >/dev/null || { echo "openssl is required." >&2; exit 1; }

# hex: safe in URLs (database and Redis passwords).
hex() { openssl rand -hex "$1"; }
b64() { openssl rand -base64 32 | tr -d '\n'; }

pg_password=$(hex 24)
query_password=$(hex 24)
redis_password=$(hex 24)
sandbox_token=$(hex 24)
auth_secret=$(b64)
master_key=$(b64)

# Replaces `KEY=...` (first occurrence at line start) in .env.tmp.
set_var() {
  awk -v k="$1" -v v="$2" '
    !done && index($0, k "=") == 1 { print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }
  ' .env.tmp > .env.tmp2 && mv .env.tmp2 .env.tmp
}

umask 077
cp .env.example .env.tmp
set_var BETTER_AUTH_URL "$url"
set_var BETTER_AUTH_SECRET "$auth_secret"
set_var SECRETS_MASTER_KEY "$master_key"
set_var POSTGRES_PASSWORD "$pg_password"
set_var QUERY_DB_PASSWORD "$query_password"
set_var REDIS_PASSWORD "$redis_password"
set_var SANDBOX_TOKEN "$sandbox_token"
set_var WEB_PORT "$port"
# Host-side URLs (unused by the containers, which build their own).
set_var DATABASE_URL "postgres://runbase:$pg_password@localhost:5432/runbase"
set_var QUERY_DATABASE_URL "postgres://runbase_query:$query_password@localhost:5432/runbase"
set_var REDIS_URL "redis://:$redis_password@localhost:6380"
mv .env.tmp .env

cat <<EOF
.env written (mode 600) with fresh secrets. Back it up: SECRETS_MASTER_KEY
cannot be recovered.

Next:
  docker compose -f docker-compose.selfhost.yml up -d
  docker compose -f docker-compose.selfhost.yml exec worker pnpm admin:create you@example.com
Then open $url/login. Without email settings, the sign-in link is printed in:
  docker compose -f docker-compose.selfhost.yml logs web
EOF
