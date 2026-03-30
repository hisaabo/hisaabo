#!/bin/sh
set -e

echo "[entrypoint] Hisaabo API — starting up"
echo "[entrypoint] Node $(node --version) | ENV=${NODE_ENV}"

# ── Run database migrations ────────────────────────────────────
echo "[entrypoint] Pushing database schema..."
cd /app/packages/db
npx drizzle-kit push --force 2>&1 || {
  echo "[entrypoint] WARNING: Schema push failed! Starting server anyway for health checks."
  echo "[entrypoint] Check DATABASE_URL and schema files."
}
cd /app

# ── Start the API server ───────────────────────────────────────
echo "[entrypoint] Starting Hisaabo API server on port ${PORT:-3000}..."
exec node packages/api/dist/server.js
