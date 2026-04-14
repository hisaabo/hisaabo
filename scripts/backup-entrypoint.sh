#!/bin/bash
# ── Hisaabo Backup Sidecar Entrypoint ───────────────────────────
# Configures rclone for R2/S3 and sets up cron-based backups.
set -euo pipefail

BACKUP_CRON="${BACKUP_CRON:-0 2 * * *}"

# ── Configure rclone for R2/S3 ─────────────────────────────────
if [ -n "${R2_ACCESS_KEY_ID:-}" ] && [ -n "${R2_SECRET_ACCESS_KEY:-}" ] && [ -n "${R2_ENDPOINT:-}" ]; then
  mkdir -p /root/.config/rclone
  cat > /root/.config/rclone/rclone.conf <<EOF
[r2]
type = s3
provider = Cloudflare
access_key_id = ${R2_ACCESS_KEY_ID}
secret_access_key = ${R2_SECRET_ACCESS_KEY}
endpoint = ${R2_ENDPOINT}
acl = private
no_check_bucket = true
EOF
  echo "rclone configured for R2"
else
  echo "WARN: R2 credentials not set — offsite backup disabled (local backups only)"
fi

# ── Set up cron schedule ────────────────────────────────────────
# Build env vars to pass into cron job
ENV_FILE="/etc/backup.env"
env | grep -E '^(PGHOST|PGPORT|PGUSER|PGPASSWORD|DB_USER|BACKUP_|R2_|PATH)=' > "$ENV_FILE" || true

CRON_LINE="$BACKUP_CRON /bin/bash -c 'source /etc/backup.env && /usr/local/bin/backup.sh' >> /var/log/backup.log 2>&1"
echo "$CRON_LINE" | crontab -

echo "Backup cron scheduled: $BACKUP_CRON"
echo "Starting cron daemon..."

# Ensure log file exists for tail
touch /var/log/backup.log

# Run crond in foreground
exec crond -f -l 2
