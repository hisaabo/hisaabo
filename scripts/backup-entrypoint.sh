#!/bin/bash
# ── Hisaabo Backup Sidecar Entrypoint ───────────────────────────
# Configures rclone for R2/S3 and sets up cron-based backups.
set -euo pipefail
# Everything created below holds credentials: owner-only by default.
umask 077

BACKUP_CRON="${BACKUP_CRON:-0 2 * * *}"

# crond runs as root (it must, to switch users), but the backup JOB runs as the
# unprivileged BACKUP_USER: busybox crond executes each crontab as its owner.
# Everything the job reads or writes below is owned by that user, mode 0600/0700.
BACKUP_USER="${BACKUP_USER:-backup}"
BACKUP_HOME="$(getent passwd "$BACKUP_USER" | cut -d: -f6)"
BACKUP_DIR="/var/backups/hisaabo" # must match backup.sh

# The backup volume may hold files from earlier (root-run) versions of this image.
mkdir -p "$BACKUP_DIR"
chown -R "$BACKUP_USER:$BACKUP_USER" "$BACKUP_DIR" \
  || echo "WARN: could not chown $BACKUP_DIR to $BACKUP_USER; backups may fail to write"
chmod 700 "$BACKUP_DIR"

# ── Configure rclone for R2/S3 ─────────────────────────────────
if [ -n "${R2_ACCESS_KEY_ID:-}" ] && [ -n "${R2_SECRET_ACCESS_KEY:-}" ] && [ -n "${R2_ENDPOINT:-}" ]; then
  mkdir -p "$BACKUP_HOME/.config/rclone"
  chmod 700 "$BACKUP_HOME/.config/rclone"
  cat > "$BACKUP_HOME/.config/rclone/rclone.conf" <<EOF
[r2]
type = s3
provider = Cloudflare
access_key_id = ${R2_ACCESS_KEY_ID}
secret_access_key = ${R2_SECRET_ACCESS_KEY}
endpoint = ${R2_ENDPOINT}
acl = private
no_check_bucket = true
EOF
  chmod 600 "$BACKUP_HOME/.config/rclone/rclone.conf"
  chown -R "$BACKUP_USER:$BACKUP_USER" "$BACKUP_HOME/.config"
  echo "rclone configured for R2"
  if [ -z "${BACKUP_ENCRYPTION_KEY:-}" ]; then
    echo "WARN: BACKUP_ENCRYPTION_KEY is not set — scheduled backups will FAIL at the offsite upload step (unencrypted uploads are refused)"
  fi
else
  echo "WARN: R2 credentials not set — offsite backup disabled (local backups only)"
fi

# ── Set up cron schedule ────────────────────────────────────────
# Build env vars to pass into cron job. Values are shell-quoted (%q) and exported
# so they survive `source` (BACKUP_CRON contains spaces and `*`), and the file is
# owner-readable only because it contains database and storage credentials.
ENV_FILE="/etc/backup.env"
( umask 077; : > "$ENV_FILE" )
chmod 600 "$ENV_FILE"
chown "$BACKUP_USER:$BACKUP_USER" "$ENV_FILE"
for var in $(compgen -e | grep -E '^(PGHOST|PGPORT|PGUSER|PGPASSWORD|DB_USER|BACKUP_[A-Z_]*|R2_[A-Z_]*|PATH)$'); do
  printf 'export %s=%q\n' "$var" "${!var}" >> "$ENV_FILE"
done

CRON_LINE="$BACKUP_CRON /bin/bash -c 'source /etc/backup.env && /usr/local/bin/backup.sh' >> /var/log/backup.log 2>&1"
echo "$CRON_LINE" | crontab -u "$BACKUP_USER" -

echo "Backup cron scheduled: $BACKUP_CRON"
echo "Starting cron daemon..."

# Ensure log file exists for tail
touch /var/log/backup.log
chown "$BACKUP_USER:$BACKUP_USER" /var/log/backup.log
chmod 600 /var/log/backup.log

# Run crond in foreground
exec crond -f -l 2
