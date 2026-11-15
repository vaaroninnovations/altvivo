#!/usr/bin/env bash
# =============================================================================
# AltVivo encrypted backup
#
#   * pg_dumpall --globals-only (roles, grants)
#   * pg_dump -Fc of every application database (db_core incl. the
#     hash-chained audit_logs, plus one database per spoke)
#   * Redis RDB snapshot (refresh-token families, revocations, queues)
#   * infra config snapshot (Caddyfile, routes, compose, pg_hba, redis.conf)
#   * manifest with SHA-256 of every artefact
#
# Everything is streamed into one tar archive encrypted with `age` to the
# PUBLIC key(s) in BACKUP_AGE_RECIPIENTS_FILE. The private key never lives on
# this server, so a compromised host cannot read old backups.
# The encrypted archive is uploaded with rclone (e.g. to Cloudflare R2).
#
# Run as root (docker access):  sudo ./scripts/backup.sh
# Scheduled by systemd/altvivo-backup.timer.
# =============================================================================
set -Eeuo pipefail
umask 077
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_root "$@"
require_cmd docker age tar sha256sum flock gzip

[[ -f "$ENV_FILE" ]] || die ".env not found at $ENV_FILE"

PG_SUPERUSER="$(env_get POSTGRES_SUPERUSER || echo altvivo_admin)"
LOCAL_DIR="$(env_get BACKUP_LOCAL_DIR || echo /var/backups/altvivo)"
LOCAL_RETENTION="$(env_get BACKUP_LOCAL_RETENTION_DAYS || echo 7)"
REMOTE="$(env_get BACKUP_RCLONE_REMOTE || true)"
REMOTE_RETENTION="$(env_get BACKUP_REMOTE_RETENTION_DAYS || echo 35)"
HEARTBEAT="$(env_get BACKUP_HEARTBEAT_URL || true)"
REDIS_BACKUP_PASSWORD="$(env_get REDIS_BACKUP_PASSWORD)" || die "REDIS_BACKUP_PASSWORD missing"
RECIPIENTS="$(env_get BACKUP_AGE_RECIPIENTS_FILE || echo ./secrets/backup/age_recipients.txt)"
[[ "$RECIPIENTS" = /* ]] || RECIPIENTS="$INFRA_DIR/${RECIPIENTS#./}"

[[ -s "$RECIPIENTS" ]] || die "age recipients file missing/empty: $RECIPIENTS"
grep -qE '^age1[0-9a-z]{58}$' "$RECIPIENTS" || die "no valid age public key in $RECIPIENTS"
[[ "$LOCAL_RETENTION" =~ ^[0-9]+$ ]] || die "BACKUP_LOCAL_RETENTION_DAYS must be an integer"
[[ "$REMOTE_RETENTION" =~ ^[0-9]+$ ]] || die "BACKUP_REMOTE_RETENTION_DAYS must be an integer"
if [[ -n "$REMOTE" ]]; then require_cmd rclone; fi
if [[ -n "$HEARTBEAT" ]]; then require_cmd curl; fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
HOST="$(hostname -s)"
NAME="altvivo-${HOST}-${STAMP}"
mkdir -p "$LOCAL_DIR"
chmod 700 "$LOCAL_DIR"

exec 9>/run/lock/altvivo-backup.lock
flock -n 9 || die "another backup is already running"

WORK="$(mktemp -d "$LOCAL_DIR/.work.XXXXXX")"
on_exit() {
  local rc=$?
  rm -rf "$WORK"
  rm -f "$LOCAL_DIR"/*.partial
  if (( rc != 0 )); then
    warn "backup FAILED (exit $rc)"
    if [[ -n "$HEARTBEAT" ]]; then curl -fsS -m 10 --retry 3 "${HEARTBEAT%/}/fail" >/dev/null 2>&1 || true; fi
  fi
  exit "$rc"
}
trap on_exit EXIT
trap 'warn "command failed at line $LINENO: $BASH_COMMAND"' ERR

if [[ -n "$HEARTBEAT" ]]; then curl -fsS -m 10 --retry 3 "${HEARTBEAT%/}/start" >/dev/null 2>&1 || true; fi

dc ps --status running --services | grep -qx postgres || die "postgres container is not running"
dc ps --status running --services | grep -qx redis || die "redis container is not running"

mkdir -p "$WORK/$NAME/postgres" "$WORK/$NAME/redis" "$WORK/$NAME/config"
OUT="$WORK/$NAME"

# ---------------------------------------------------------------- Postgres --
log "Dumping PostgreSQL globals"
dc exec -T postgres pg_dumpall -U "$PG_SUPERUSER" --globals-only | gzip -9 >"$OUT/postgres/globals.sql.gz"

mapfile -t DATABASES < <(dc exec -T postgres psql -U "$PG_SUPERUSER" -d postgres -AtX -c \
  "SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate AND datname <> 'postgres' ORDER BY 1")
(( ${#DATABASES[@]} > 0 )) || die "no databases found"

for db in "${DATABASES[@]}"; do
  db="${db//$'\r'/}"
  [[ "$db" =~ ^[a-z][a-z0-9_]*$ ]] || die "unexpected database name '$db'"
  log "Dumping database $db"
  dc exec -T postgres pg_dump -U "$PG_SUPERUSER" -d "$db" -Fc -Z 6 --no-sync >"$OUT/postgres/${db}.dump"
  # Verify the archive is readable (TOC parses end to end).
  dc exec -T postgres pg_restore --list <"$OUT/postgres/${db}.dump" >/dev/null \
    || die "pg_restore could not read dump of $db"
done

# Audit chain head, so a restore can be proven complete and untampered.
if printf '%s\n' "${DATABASES[@]}" | grep -qx db_core; then
  dc exec -T postgres psql -U "$PG_SUPERUSER" -d db_core -AtX -c \
    "SELECT COALESCE((SELECT id || ' ' || record_hash FROM audit_logs ORDER BY id DESC LIMIT 1), 'empty')" \
    >"$OUT/postgres/audit_chain_head.txt" 2>/dev/null || echo "unavailable (schema not migrated yet)" >"$OUT/postgres/audit_chain_head.txt"
fi

# ------------------------------------------------------------------- Redis --
log "Snapshotting Redis"
redis_cli() { dc exec -T -e REDISCLI_AUTH="$REDIS_BACKUP_PASSWORD" redis redis-cli --no-auth-warning --user backup "$@"; }
before="$(redis_cli LASTSAVE | tr -d '\r')"
redis_cli BGSAVE >/dev/null
for _ in $(seq 1 120); do
  sleep 1
  now="$(redis_cli LASTSAVE | tr -d '\r')"
  [[ "$now" != "$before" ]] && break
done
[[ "$now" != "$before" ]] || die "Redis BGSAVE did not complete within 120s"
redis_cli INFO persistence | tr -d '\r' | grep -q '^rdb_last_bgsave_status:ok' || die "Redis BGSAVE reported failure"
dc cp redis:/data/dump.rdb "$OUT/redis/dump.rdb"

# ------------------------------------------------------------------ Config --
log "Capturing infra configuration (no secrets)"
tar -C "$INFRA_DIR" -czf "$OUT/config/infra-config.tar.gz" \
  docker-compose.yml caddy postgres/pg_hba.conf redis/redis.conf .env.example

# ---------------------------------------------------------------- Manifest --
{
  echo "name=$NAME"
  echo "created_utc=$STAMP"
  echo "host=$HOST"
  echo "postgres_version=$(dc exec -T postgres postgres --version | tr -d '\r')"
  echo "redis_version=$(dc exec -T redis redis-server --version | tr -d '\r')"
  echo "databases=${DATABASES[*]}"
  echo "audit_chain_head=$(tr -d '\r\n' <"$OUT/postgres/audit_chain_head.txt" 2>/dev/null || echo n/a)"
  echo "--- sha256 ---"
  (cd "$OUT" && find . -type f ! -name MANIFEST -print0 | sort -z | xargs -0 sha256sum)
} >"$OUT/MANIFEST"

# --------------------------------------------------------- Encrypt & store --
ARCHIVE="$LOCAL_DIR/${NAME}.tar.age"
log "Encrypting archive -> $ARCHIVE"
tar -C "$WORK" -cf - "$NAME" | age --encrypt -R "$RECIPIENTS" -o "${ARCHIVE}.partial"
mv -f "${ARCHIVE}.partial" "$ARCHIVE"
(cd "$LOCAL_DIR" && sha256sum "$(basename "$ARCHIVE")" >"$(basename "$ARCHIVE").sha256")
SIZE="$(du -h "$ARCHIVE" | cut -f1)"
log "Archive ready ($SIZE)"

if [[ -n "$REMOTE" ]]; then
  log "Uploading to $REMOTE"
  rclone copyto "$ARCHIVE" "${REMOTE%/}/$(basename "$ARCHIVE")" --s3-no-check-bucket --retries 5 --low-level-retries 10
  rclone copyto "${ARCHIVE}.sha256" "${REMOTE%/}/$(basename "$ARCHIVE").sha256" --s3-no-check-bucket --retries 5
  rclone check "$LOCAL_DIR" "${REMOTE%/}" --one-way --include "$(basename "$ARCHIVE")" --s3-no-check-bucket \
    || die "remote checksum verification failed"
  log "Pruning remote archives older than ${REMOTE_RETENTION}d"
  rclone delete "${REMOTE%/}" --min-age "${REMOTE_RETENTION}d" --include 'altvivo-*.tar.age*' --s3-no-check-bucket
else
  warn "BACKUP_RCLONE_REMOTE not set - backup kept on this host only"
fi

log "Pruning local archives older than ${LOCAL_RETENTION}d"
find "$LOCAL_DIR" -maxdepth 1 -type f -name 'altvivo-*.tar.age*' -mtime "+${LOCAL_RETENTION}" -delete

if [[ -n "$HEARTBEAT" ]]; then curl -fsS -m 10 --retry 3 "$HEARTBEAT" >/dev/null 2>&1 || true; fi
log "Backup complete: $NAME"
