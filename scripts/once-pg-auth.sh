#!/bin/sh
# Hisaabo ONCE image: PostgreSQL password authentication.
#
#   once-pg-auth.sh ensure-secret   create the random app password if missing
#   once-pg-auth.sh prepare         (flock owner, PG stopped) init cluster if
#                                   empty, set the role password, enforce
#                                   scram-sha-256 in pg_hba.conf (idempotent)
#
# The password lives in $SECRET_DIR/pg_app_password (0600, dir 0700) inside the
# persistent volume. It is never printed.
set -eu
umask 077

PGDATA="${PGDATA:-/storage/pgdata}"
SECRET_DIR="${SECRET_DIR:-/storage/secrets}"
SECRET_FILE="$SECRET_DIR/pg_app_password"
PG_BIN="${PG_BIN:-/usr/libexec/postgresql16}"
PG_CLIENT_BIN="${PG_CLIENT_BIN:-}"
PG_ROLE="${PG_ROLE:-postgres}"
RUN_AS="${RUN_AS:-su-exec postgres}"
PG_OWNER="${PG_OWNER:-postgres}"

psql_bin() { if [ -n "$PG_CLIENT_BIN" ]; then echo "$PG_CLIENT_BIN/psql"; else echo psql; fi; }

ensure_secret() {
  mkdir -p "$SECRET_DIR"
  chmod 700 "$SECRET_DIR"
  (
    flock 9
    if [ ! -s "$SECRET_FILE" ]; then
      tmp="$SECRET_FILE.tmp.$$"
      openssl rand -hex 32 > "$tmp"
      chmod 600 "$tmp"
      mv "$tmp" "$SECRET_FILE"
      echo "[pg-auth] Generated database password"
    fi
  ) 9>"$SECRET_DIR/.lock"
  chmod 600 "$SECRET_FILE"
}

has_trust() {
  grep -Eq '^[^#]*[[:space:]]trust([[:space:]]|$)' "$PGDATA/pg_hba.conf"
}

write_hba() {
  if [ -f "$PGDATA/pg_hba.conf" ] && has_trust; then
    bak="$PGDATA/pg_hba.conf.bak.$(date -u +%Y%m%dT%H%M%SZ)"
    cp -p "$PGDATA/pg_hba.conf" "$bak"
    echo "[pg-auth] Backed up previous pg_hba.conf to $bak"
  elif [ -f "$PGDATA/pg_hba.conf" ] && grep -Eq '^local[[:space:]]+all[[:space:]]+all[[:space:]]+scram-sha-256' "$PGDATA/pg_hba.conf"; then
    return 0
  fi
  tmp="$PGDATA/pg_hba.conf.new.$$"
  cat > "$tmp" <<HBA
# Managed by Hisaabo ONCE: password (scram-sha-256) authentication only.
local   all   all                    scram-sha-256
host    all   all   127.0.0.1/32     scram-sha-256
host    all   all   ::1/128          scram-sha-256
HBA
  chown "$PG_OWNER" "$tmp" 2>/dev/null || true
  chmod 600 "$tmp"
  mv "$tmp" "$PGDATA/pg_hba.conf"
  echo "[pg-auth] pg_hba.conf now requires scram-sha-256"
}

prepare() {
  ensure_secret
  mkdir -p "$PGDATA"
  chown "$PG_OWNER" "$PGDATA" 2>/dev/null || true
  chmod 700 "$PGDATA"

  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    echo "[pg-auth] Initializing new database cluster..."
    $RUN_AS "$PG_BIN/initdb" -D "$PGDATA" --auth=trust --no-locale --encoding=UTF8 >/dev/null
  fi
  rm -f "$PGDATA/postmaster.pid"

  # Private, socket-only bootstrap instance with a throwaway trust hba so the
  # role password can be (re)set whatever the current pg_hba.conf says.
  boot="$(mktemp -d)"
  chown "$PG_OWNER" "$boot"
  printf 'local all all trust\n' > "$boot/hba.conf"
  chown "$PG_OWNER" "$boot/hba.conf"
  trap 'rm -rf "$boot"' EXIT

  $RUN_AS "$PG_BIN/pg_ctl" -D "$PGDATA" -w -t 60 -s \
    -o "-c listen_addresses= -c unix_socket_directories=$boot -c hba_file=$boot/hba.conf -c fsync=on" \
    -l "$boot/log" start || { cat "$boot/log" >&2 || true; echo "[pg-auth] FATAL: bootstrap start failed" >&2; exit 1; }

  # shellcheck disable=SC2016
  if ! { printf '\\set pw `cat "%s"`\nALTER ROLE "%s" WITH LOGIN PASSWORD :'"'"'pw'"'"';\n' "$SECRET_FILE" "$PG_ROLE" |
         "$(psql_bin)" -h "$boot" -U "$PG_ROLE" -d postgres -v ON_ERROR_STOP=1 -q >/dev/null; }; then
    $RUN_AS "$PG_BIN/pg_ctl" -D "$PGDATA" -w -m fast -s stop || true
    echo "[pg-auth] FATAL: could not set database password" >&2
    exit 1
  fi

  $RUN_AS "$PG_BIN/pg_ctl" -D "$PGDATA" -w -m fast -s stop
  write_hba
}

case "${1:-}" in
  ensure-secret) ensure_secret ;;
  prepare) prepare ;;
  *) echo "usage: $0 ensure-secret|prepare" >&2; exit 2 ;;
esac
