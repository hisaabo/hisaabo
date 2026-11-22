#!/usr/bin/env bash
# Maintenance banner and lockout for a Docker Compose install (works with v0.9.0 and later).
#
#   scripts/maintenance.sh schedule "2026-11-23 21:30" "2026-11-23 22:00" "Upgrade to 0.10"
#   scripts/maintenance.sh on  ["message"]   # red banner; blocks all business data until `off`
#   scripts/maintenance.sh off               # back to normal, banner gone
#   scripts/maintenance.sh status
#
# schedule: amber "Scheduled maintenance" banner until the start time; nothing is blocked.
#           Times are Asia/Kolkata unless they carry an offset (MAINTENANCE_TZ to change).
# on:       keeps the scheduled message and end time unless a new message is given.
# Users see a change within about a minute.
#
# Run it next to docker-compose.prod.yml and .env.prod. Override with
# COMPOSE_FILE / ENV_FILE, or set PSQL to any psql command for the control database.
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.prod}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
TZ_NAME="${MAINTENANCE_TZ:-Asia/Kolkata}"

env_value() { [ -f "$ENV_FILE" ] && sed -n "s/^$1=//p" "$ENV_FILE" | tail -1 | tr -d '"'"'"; }

if [ -z "${PSQL:-}" ]; then
  PGUSER_="$(env_value POSTGRES_USER)"; PGDB_="$(env_value POSTGRES_DB)"
  PSQL="docker compose --env-file $ENV_FILE -f $COMPOSE_FILE exec -T postgres psql -U ${PGUSER_:-hisaabo} -d ${PGDB_:-hisaabo}"
fi

run() { $PSQL -v ON_ERROR_STOP=1 -X -q -At -v tz="$TZ_NAME" "$@"; }

status() {
  run -c "SELECT coalesce((SELECT CASE
      WHEN (value->>'enabled')::boolean THEN 'ON (data blocked)'
      WHEN value->>'startsAt' IS NOT NULL AND (value->>'startsAt')::timestamptz > now() THEN 'SCHEDULED'
      ELSE 'OFF' END || E'\n' || jsonb_pretty(value)
    FROM system_config WHERE key = 'maintenance'), 'OFF')"
}

case "${1:-}" in
  schedule)
    [ $# -eq 4 ] || { echo "usage: $0 schedule \"<start>\" \"<end>\" \"<message>\"" >&2; exit 2; }
    run -v start="$2" -v end="$3" -v msg="$4" <<'SQL'
SET TIME ZONE :'tz';
INSERT INTO system_config (key, value, updated_at)
VALUES ('maintenance', jsonb_build_object('enabled', false, 'message', :'msg',
        'startsAt', (:'start')::timestamptz, 'endsAt', (:'end')::timestamptz), now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
SQL
    ;;
  on)
    run -v msg="${2:-}" <<'SQL'
INSERT INTO system_config (key, value, updated_at)
VALUES ('maintenance', jsonb_build_object('enabled', true, 'message', :'msg', 'startsAt', NULL, 'endsAt', NULL), now())
ON CONFLICT (key) DO UPDATE SET updated_at = now(), value =
  system_config.value || jsonb_build_object('enabled', true)
  || CASE WHEN :'msg' <> '' THEN jsonb_build_object('message', :'msg') ELSE '{}'::jsonb END;
SQL
    ;;
  off)
    run -c "INSERT INTO system_config (key, value, updated_at)
            VALUES ('maintenance', '{\"enabled\":false,\"message\":\"\",\"startsAt\":null,\"endsAt\":null}', now())
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()"
    ;;
  status) ;;
  *) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
status
