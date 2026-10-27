#!/bin/bash
# SessionStart, Claude Code cloud sessions only: the container runs `npm run ci` as GitHub CI does
# (docs/BACKEND_GUIDE.md §8.4, "the same command and the same result").
#
#   1. The Node major `.nvmrc` names (package.json's engines agree) first on PATH. The image's
#      default is newer, and Node 22's larger heap hid a backend suite that ran out of memory on
#      Node 20 in CI (27/10/2026).
#   2. PostgreSQL 16 with pgvector and Redis running, as CI's service containers, with the mycity
#      superuser and the mycity_test database made when missing.
#   3. RUN_DB_TESTS, DATABASE_URL and REDIS_URL as CI's backend job sets them, so jest runs the
#      integration files and the migration gates their live round trip.
#   4. MYCITY_CHROMIUM: the image's own Chromium for the screen gates, since it does not carry the
#      build the repository's Playwright pins.
#
# Each step looks before it acts, so running it again changes nothing. The container can stop
# PostgreSQL and Redis during a session; run it by hand then: bash .claude/hooks/session-start.sh
set -euo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
ENV_FILE="${CLAUDE_ENV_FILE:-}"
note() { echo "session-start: $*" >&2; }
# Set for this script and, through CLAUDE_ENV_FILE, for every command the session runs.
remember() {
  export "$1=$2"
  if [ -n "$ENV_FILE" ]; then echo "export $1=\"$2\"" >> "$ENV_FILE"; fi
}

# 1. Node, the major CI uses.
major="$(sed 's/^v//' "$ROOT/.nvmrc" | cut -d. -f1 | tr -dc '0-9')"
if [ -x "/opt/node${major}/bin/node" ]; then
  export PATH="/opt/node${major}/bin:$PATH"
  if [ -n "$ENV_FILE" ]; then echo "export PATH=\"/opt/node${major}/bin:\$PATH\"" >> "$ENV_FILE"; fi
else
  note "no Node ${major} under /opt: npm run ci refuses $(node -v)"
fi

# 2. PostgreSQL and Redis, as CI's service containers.
if command -v pg_isready >/dev/null 2>&1; then
  pg_isready -q -h 127.0.0.1 || service postgresql start >/dev/null
  for _ in $(seq 1 30); do pg_isready -q -h 127.0.0.1 && break; sleep 0.5; done
  as_postgres() { runuser -u postgres -- psql -v ON_ERROR_STOP=1 -tAq "$@"; }
  [ "$(as_postgres -c "SELECT 1 FROM pg_roles WHERE rolname = 'mycity'")" = "1" ] ||
    as_postgres -c "CREATE ROLE mycity LOGIN SUPERUSER PASSWORD 'mycity'"
  [ "$(as_postgres -c "SELECT 1 FROM pg_database WHERE datname = 'mycity_test'")" = "1" ] ||
    as_postgres -c "CREATE DATABASE mycity_test OWNER mycity"
else
  note "no PostgreSQL in this image: the integration files will not run"
fi
if command -v redis-server >/dev/null 2>&1; then
  # Nothing saved, and never into the repository (a dump.rdb was once committed by mistake).
  redis-cli -h 127.0.0.1 ping >/dev/null 2>&1 ||
    redis-server --daemonize yes --save "" --appendonly no --dir /tmp >/dev/null
fi

# 3. What CI's backend job sets for the gates that read it.
remember RUN_DB_TESTS 1
remember DATABASE_URL "postgres://mycity:mycity@127.0.0.1:5432/mycity_test"
remember REDIS_URL "redis://127.0.0.1:6379/15"

# 4. Chromium for the screen gates.
if [ -z "${MYCITY_CHROMIUM:-}" ] && [ -x /opt/pw-browsers/chromium ]; then
  remember MYCITY_CHROMIUM /opt/pw-browsers/chromium
fi

echo "Cloud session set up as CI: Node $(node -v), PostgreSQL and Redis running, integration tests on."
