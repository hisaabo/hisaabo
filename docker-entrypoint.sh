#!/bin/sh
set -e

# ── Queue worker: `docker run <image> worker` / compose `command: worker` ──
# The worker never runs migrations — the API container does, and the worker
# waits until the job queue schema is installed. See docs/architecture/queue.md.
if [ "$1" = "worker" ]; then
  echo "[entrypoint] Hisaabo queue worker — starting up (Node $(node --version))"
  if [ -z "$DATABASE_URL" ]; then
    echo "[entrypoint] FATAL: DATABASE_URL is not set."
    exit 1
  fi
  exec node packages/api/dist/worker.js
fi

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
