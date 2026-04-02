#!/bin/sh
set -e

echo "[entrypoint] Hisaabo API — starting up"
echo "[entrypoint] Node $(node --version) | ENV=${NODE_ENV}"

# ── Run database migrations ────────────────────────────────────
echo "[entrypoint] Running database migrations..."
cd /app/packages/db
npx drizzle-kit migrate 2>&1 || {
  echo "[entrypoint] WARNING: Migration failed! Starting server anyway for health checks."
  echo "[entrypoint] Check DATABASE_URL and migration files."
}
cd /app

# ── Start the API server ───────────────────────────────────────
echo "[entrypoint] Starting Hisaabo API server on port ${PORT:-3000}..."
exec npx tsx packages/api/dist/server.js
