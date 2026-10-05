#!/bin/bash
# ── Hisaabo Admin Dashboard ──────────────────────────────────────
# Opens the live admin TUI (tenants, users, invoices, amount managed, …).
#
# Usage:
#   scripts/admin.sh                 # inside the running hisaabo-api container
#   scripts/admin.sh --once          # one static snapshot (good for logs / cron)
#   scripts/admin.sh --json          # raw numbers as JSON
#   scripts/admin.sh --view tenants  # start on the tenants table
#
# Env vars:
#   HISAABO_API_CONTAINER   — container name (default: hisaabo-api)
#
# The dashboard runs with plain `node` inside the API image and reaches
# Postgres with the container's own DATABASE_URL. It is strictly read-only.
set -euo pipefail

CONTAINER="${HISAABO_API_CONTAINER:-hisaabo-api}"
TTY_FLAGS="-i"
if [ -t 0 ] && [ -t 1 ]; then
  TTY_FLAGS="-it"
fi

exec docker exec $TTY_FLAGS -e TERM="${TERM:-xterm-256color}" -e COLUMNS="${COLUMNS:-$(tput cols 2>/dev/null || echo 120)}" -e LINES="${LINES:-$(tput lines 2>/dev/null || echo 40)}" \
  "$CONTAINER" node packages/api/dist/bin/admin.js "$@"
