#!/bin/sh
set -e

echo "[entrypoint] Hisaabo API — starting up"
echo "[entrypoint] Node $(node --version) | ENV=${NODE_ENV}"

# ── Validate required env vars ────────────────────────────────
if [ -z "$DATABASE_URL" ]; then
  echo "[entrypoint] FATAL: DATABASE_URL is not set. Cannot start without a database connection."
  exit 1
fi

# ── Run database migrations ────────────────────────────────────
echo "[entrypoint] Running database migrations..."
if ! node /app/packages/db/dist/migrate.mjs; then
  echo "[entrypoint] FATAL: Migration failed! Refusing to start with potentially inconsistent DB."
  echo "[entrypoint] Check DATABASE_URL and migration files."
  exit 1
fi

# ── Start the API server ───────────────────────────────────────
echo "[entrypoint] Starting Hisaabo API server on port ${PORT:-3000}..."
exec node packages/api/dist/server.js
