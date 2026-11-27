#!/bin/sh
# One-command self-host: writes .env if missing, starts the stack, creates
# the first account, then prints the login URL and the MCP connect commands.
#   ./run.sh [email]
set -eu
cd "$(dirname "$0")"

[ -f .env ] || ./setup.sh

compose() { docker compose -f docker-compose.selfhost.yml "$@"; }
echo "Starting Runbase (first start pulls the images)..."
compose up -d --wait

url=$(sed -n 's/^BETTER_AUTH_URL=//p' .env | head -n 1)
url=${url:-http://localhost:3000}

email="${1:-}"
if [ -z "$email" ]; then
  printf "Admin email (leave empty to skip): "
  read -r email || email=""
fi
if [ -n "$email" ]; then
  # admin:create fails when the account already exists: that is fine.
  compose exec -T worker pnpm admin:create "$email" \
    || echo "Account not created (it may already exist): $email"
fi

cat <<MSG

Runbase is running. Sign in: $url/login
Without email settings, the sign-in link is printed in:
  docker compose -f docker-compose.selfhost.yml logs web

Connect your AI agent:
  claude mcp add --transport http runbase $url/api/mcp
  codex mcp add runbase --url $url/api/mcp
  gemini mcp add --transport http runbase $url/api/mcp
MSG
