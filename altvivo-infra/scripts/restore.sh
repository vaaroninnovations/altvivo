#!/usr/bin/env bash
# =============================================================================
# AltVivo restore from an encrypted backup archive.
#
#   sudo ./scripts/restore.sh --identity /path/altvivo-backup.key \
#        --archive /var/backups/altvivo/altvivo-host-20261114T210000Z.tar.age \
#        [--only db_core] [--skip-redis] [--yes]
#
# The age PRIVATE key is supplied at restore time only (e.g. from a USB stick
# or password manager export) and is never copied onto the server.
#
# Steps:
#   1. decrypt + extract to a private temp dir, verify every SHA-256 in MANIFEST
#   2. stop application containers (caddy keeps serving the maintenance page)
#   3. restore Postgres globals (roles) and each database (drop + recreate)
#   4. restore the Redis snapshot
#   5. start everything and print the audit-chain head for comparison
#
# pg_restore loads table data BEFORE recreating triggers, so the audit_logs
# hash-chain trigger does not re-hash restored rows; the restored chain is
# byte-identical and can be re-verified with the Module 2 verification query.
# =============================================================================
set -Eeuo pipefail
umask 077
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

IDENTITY=""
ARCHIVE=""
ONLY=""
SKIP_REDIS=0
ASSUME_YES=0

while (( $# )); do
  case "$1" in
    --identity)   IDENTITY="${2:-}"; shift 2 ;;
    --archive)    ARCHIVE="${2:-}"; shift 2 ;;
    --only)       ONLY="${2:-}"; shift 2 ;;
    --skip-redis) SKIP_REDIS=1; shift ;;
    --yes)        ASSUME_YES=1; shift ;;
    -h|--help)    sed -n '3,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)            die "unknown argument: $1" ;;
  esac
done

require_root
require_cmd docker age tar sha256sum
[[ -f "$IDENTITY" ]] || die "--identity <age private key file> is required"
[[ -f "$ARCHIVE" ]] || die "--archive <file.tar.age> is required"
[[ -f "$ENV_FILE" ]] || die ".env not found"
[[ -z "$ONLY" || "$ONLY" =~ ^[a-z][a-z0-9_]*$ ]] || die "invalid --only database name"

PG_SUPERUSER="$(env_get POSTGRES_SUPERUSER || echo altvivo_admin)"

if [[ -f "${ARCHIVE}.sha256" ]]; then
  log "Verifying archive checksum"
  (cd "$(dirname "$ARCHIVE")" && sha256sum -c "$(basename "$ARCHIVE").sha256") || die "archive checksum mismatch"
fi

WORK="$(mktemp -d /var/tmp/altvivo-restore.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

log "Decrypting and extracting"
age --decrypt -i "$IDENTITY" "$ARCHIVE" | tar -C "$WORK" -xf - --no-same-owner
NAME="$(find "$WORK" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | head -n1)"
SRC="$WORK/$NAME"
[[ -f "$SRC/MANIFEST" ]] || die "MANIFEST missing - not an AltVivo backup"

log "Verifying artefact checksums"
(cd "$SRC" && sed -n '/^--- sha256 ---$/,$p' MANIFEST | tail -n +2 | sha256sum -c --quiet) || die "artefact checksum mismatch"
sed -n '1,/^--- sha256 ---$/p' "$SRC/MANIFEST" | sed '$d'

mapfile -t DBS < <(find "$SRC/postgres" -maxdepth 1 -name '*.dump' -printf '%f\n' | sed 's/\.dump$//' | sort)
if [[ -n "$ONLY" ]]; then
  printf '%s\n' "${DBS[@]}" | grep -qx "$ONLY" || die "database '$ONLY' not in this backup"
  DBS=("$ONLY")
fi

echo
echo "This will DROP and RECREATE: ${DBS[*]}"
(( SKIP_REDIS )) || echo "and REPLACE the Redis dataset (all sessions will be logged out)."
if (( ! ASSUME_YES )); then
  read -r -p "Type RESTORE to continue: " answer
  [[ "$answer" == "RESTORE" ]] || die "aborted"
fi

APP_SERVICES=(altvivo-core altvivo-web xprism amaze)
log "Stopping application services: ${APP_SERVICES[*]}"
dc stop "${APP_SERVICES[@]}" || true

dc up -d postgres redis
for _ in $(seq 1 60); do
  dc exec -T postgres pg_isready -h /var/run/postgresql -U "$PG_SUPERUSER" -d postgres >/dev/null 2>&1 && break
  sleep 2
done

psql_admin() { dc exec -T postgres psql -v ON_ERROR_STOP=1 -X -U "$PG_SUPERUSER" "$@"; }

if [[ -z "$ONLY" ]]; then
  log "Restoring globals (existing roles produce harmless 'already exists' notices)"
  gunzip -c "$SRC/postgres/globals.sql.gz" \
    | grep -vE "^(CREATE|ALTER) ROLE ${PG_SUPERUSER}( |;)" \
    | dc exec -T postgres psql -X -q -U "$PG_SUPERUSER" -d postgres >/dev/null || true
fi

for db in "${DBS[@]}"; do
  log "Restoring database $db"
  if [[ "$db" == "db_core" ]]; then owner="core_migrator"; else owner="$db"; fi
  psql_admin -d postgres -AtX -c "SELECT 1 FROM pg_roles WHERE rolname = '${owner}'" | grep -q 1 \
    || die "role '${owner}' does not exist (restore globals first, or run without --only)"
  psql_admin -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${db}' AND pid <> pg_backend_pid();" >/dev/null
  psql_admin -d postgres -c "DROP DATABASE IF EXISTS \"${db}\";"
  psql_admin -d postgres -c "CREATE DATABASE \"${db}\" OWNER \"${owner}\" ENCODING 'UTF8' TEMPLATE template0;"
  psql_admin -d postgres -c "REVOKE ALL ON DATABASE \"${db}\" FROM PUBLIC;"
  # Atomic: either the whole database restores or nothing does.
  dc exec -T postgres pg_restore -U "$PG_SUPERUSER" -d "$db" --exit-on-error --single-transaction \
    <"$SRC/postgres/${db}.dump"
  if [[ "$db" == "db_core" ]]; then
    psql_admin -d postgres -c "GRANT CONNECT, TEMPORARY ON DATABASE db_core TO core_app;"
    psql_admin -d postgres -c "GRANT CONNECT ON DATABASE db_core TO core_readonly;"
  else
    psql_admin -d postgres -c "GRANT CONNECT, TEMPORARY ON DATABASE \"${db}\" TO \"${db}\";"
  fi
done

if (( ! SKIP_REDIS )) && [[ -z "$ONLY" ]]; then
  log "Restoring Redis snapshot"
  dc stop redis
  dc run --rm --no-deps -v "$SRC/redis:/restore:ro" --entrypoint sh redis -c \
    'rm -rf /data/appendonlydir /data/appendonly.aof && cp /restore/dump.rdb /data/dump.rdb'
  # Load the RDB in a throw-away, loopback-only instance, convert it to AOF,
  # then shut down cleanly so the real service starts from the restored AOF.
  dc run -d --rm --no-deps --name altvivo-redis-restore --entrypoint redis-server redis \
    --dir /data --dbfilename dump.rdb --appendonly no --bind 127.0.0.1 --port 6380 \
    --appenddirname appendonlydir --appendfilename appendonly.aof >/dev/null
  rcli() { docker exec altvivo-redis-restore redis-cli -p 6380 "$@" | tr -d '\r'; }
  for _ in $(seq 1 60); do rcli PING 2>/dev/null | grep -q PONG && break; sleep 1; done
  rcli INFO persistence | grep -q '^loading:0' || sleep 5
  log "Redis keys restored: $(rcli DBSIZE)"
  rcli CONFIG SET appendonly yes >/dev/null
  for _ in $(seq 1 300); do
    info="$(rcli INFO persistence)"
    grep -q '^aof_rewrite_in_progress:0' <<<"$info" && grep -q '^aof_rewrite_scheduled:0' <<<"$info" \
      && grep -q '^aof_enabled:1' <<<"$info" && break
    sleep 1
  done
  rcli SHUTDOWN SAVE >/dev/null 2>&1 || true
  for _ in $(seq 1 30); do docker ps -q -f name=altvivo-redis-restore | grep -q . || break; sleep 1; done
  dc up -d redis
fi

log "Starting application services"
dc up -d

if printf '%s\n' "${DBS[@]}" | grep -qx db_core; then
  log "Audit chain head in backup : $(cat "$SRC/postgres/audit_chain_head.txt" 2>/dev/null || echo n/a)"
  log "Audit chain head restored  : $(psql_admin -d db_core -AtX -c "SELECT COALESCE((SELECT id || ' ' || record_hash FROM audit_logs ORDER BY id DESC LIMIT 1), 'empty')" 2>/dev/null || echo n/a)"
fi
log "Restore complete from $NAME"
