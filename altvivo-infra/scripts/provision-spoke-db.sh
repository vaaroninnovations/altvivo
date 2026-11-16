#!/usr/bin/env bash
# =============================================================================
# Create the Postgres role + database for a spoke that is being launched after
# first boot (initdb only runs once).
#
#   ./scripts/provision-spoke-db.sh pharmadme
#
# Reads <APP>_DB_PASSWORD from .env (add it with
# `sudo ./scripts/generate-secrets.sh --spoke <app>`). Idempotent.
# pg_hba.conf already admits it via the `sameuser` rule.
# =============================================================================
set -Eeuo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

app="${1:-}"
[[ -n "$app" ]] || die "usage: $0 <app_id>"
is_known_app "$app" || die "unknown app '$app' (known: ${KNOWN_APPS[*]})"
require_cmd docker

PG_SUPERUSER="$(env_get POSTGRES_SUPERUSER || echo altvivo_admin)"
var="$(upper "$app")_DB_PASSWORD"
pw="$(env_get "$var")" || die "$var missing in .env (run: sudo ./scripts/generate-secrets.sh --spoke $app)"
[[ ${#pw} -ge 32 && ${#pw} -le 256 && "$pw" =~ ^[A-Za-z0-9]+$ ]] || die "$var must be 32-256 alphanumeric characters"

psql_admin() { dc exec -T postgres psql -v ON_ERROR_STOP=1 -X -q -U "$PG_SUPERUSER" "$@"; }

exists_role="$(psql_admin -d postgres -AtX -c "SELECT 1 FROM pg_roles WHERE rolname = '${app}'" | tr -d '\r')"
if [[ "$exists_role" == "1" ]]; then
  log "Role '$app' exists - updating password"
  psql_admin -d postgres <<SQL
ALTER ROLE "${app}" WITH LOGIN PASSWORD '${pw}';
SQL
else
  log "Creating role '$app'"
  psql_admin -d postgres <<SQL
CREATE ROLE "${app}" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
  CONNECTION LIMIT 40 PASSWORD '${pw}';
ALTER ROLE "${app}" SET statement_timeout = '120s';
ALTER ROLE "${app}" SET idle_in_transaction_session_timeout = '60s';
SQL
fi

exists_db="$(psql_admin -d postgres -AtX -c "SELECT 1 FROM pg_database WHERE datname = '${app}'" | tr -d '\r')"
if [[ "$exists_db" == "1" ]]; then
  log "Database '$app' already exists"
else
  log "Creating database '$app'"
  psql_admin -d postgres -c "CREATE DATABASE \"${app}\" OWNER \"${app}\" ENCODING 'UTF8' TEMPLATE template0;"
  psql_admin -d postgres -c "REVOKE ALL ON DATABASE \"${app}\" FROM PUBLIC;"
  psql_admin -d postgres -c "GRANT CONNECT, TEMPORARY ON DATABASE \"${app}\" TO \"${app}\";"
  psql_admin -d "$app" -c "REVOKE ALL ON SCHEMA public FROM PUBLIC; ALTER SCHEMA public OWNER TO \"${app}\";"
fi

log "Spoke database ready: postgres://${app}:***@postgres:5432/${app}"
