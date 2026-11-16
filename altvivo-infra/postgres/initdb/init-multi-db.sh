#!/usr/bin/env bash
# =============================================================================
# First-boot provisioning (runs once, when the data volume is empty).
#
#   db_core        owner core_migrator  (runs Prisma migrations / DDL)
#                  core_app             (runtime DML; UPDATE/DELETE on
#                                        audit_logs revoked by Module 2 migration)
#                  core_readonly        (SELECT only - reporting / auditors)
#   <spoke>        owner <spoke>        (one database per spoke, same name)
#
# Passwords arrive via container environment from .env and are validated to be
# hex/alnum so they can be embedded safely in SQL literals.
# =============================================================================
set -Eeuo pipefail

die() { echo "[initdb] ERROR: $*" >&2; exit 1; }

# Length is checked separately: the Postgres image is Alpine (musl), whose regex
# engine rejects repeat counts above 255, so `{32,256}` would fail every value.
valid_secret() { [[ ${#1} -ge 32 && ${#1} -le 256 && "$1" =~ ^[A-Za-z0-9]+$ ]]; }
valid_ident()  { [[ "$1" =~ ^[a-z][a-z0-9_]{1,30}$ ]]; }

for v in CORE_MIGRATOR_PASSWORD CORE_APP_PASSWORD CORE_READONLY_PASSWORD; do
  [[ -n "${!v:-}" ]] || die "$v is not set"
  valid_secret "${!v}" || die "$v must be 32-256 alphanumeric characters"
done

psql_super() {
  psql -v ON_ERROR_STOP=1 --no-psqlrc --username "$POSTGRES_USER" "$@"
}

echo "[initdb] Hardening template databases and creating core roles"
psql_super --dbname postgres <<SQL
-- Nobody gets implicit rights on new databases.
REVOKE ALL ON DATABASE postgres  FROM PUBLIC;
REVOKE ALL ON DATABASE template1 FROM PUBLIC;
\connect template1
REVOKE ALL ON SCHEMA public FROM PUBLIC;
\connect postgres
REVOKE ALL ON SCHEMA public FROM PUBLIC;

CREATE ROLE core_migrator WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
  CONNECTION LIMIT 5 PASSWORD '${CORE_MIGRATOR_PASSWORD}';
CREATE ROLE core_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT
  CONNECTION LIMIT 60 PASSWORD '${CORE_APP_PASSWORD}';
CREATE ROLE core_readonly WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT
  CONNECTION LIMIT 10 PASSWORD '${CORE_READONLY_PASSWORD}';

ALTER ROLE core_app      SET statement_timeout = '30s';
ALTER ROLE core_app      SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE core_app      SET lock_timeout = '10s';
ALTER ROLE core_readonly SET statement_timeout = '120s';
ALTER ROLE core_readonly SET default_transaction_read_only = on;

CREATE DATABASE db_core OWNER core_migrator ENCODING 'UTF8' TEMPLATE template0;
REVOKE ALL ON DATABASE db_core FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE db_core TO core_app;
GRANT CONNECT ON DATABASE db_core TO core_readonly;
SQL

echo "[initdb] Configuring db_core schema privileges and extensions"
psql_super --dbname db_core <<'SQL'
-- Extensions need superuser; create them up-front for Module 2.
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- digest() for the audit hash chain
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive emails
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- fuzzy search (orgs, users)

REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO core_migrator;
GRANT USAGE ON SCHEMA public TO core_app, core_readonly;

-- Objects created later by core_migrator inherit these grants automatically.
ALTER DEFAULT PRIVILEGES FOR ROLE core_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO core_app;
ALTER DEFAULT PRIVILEGES FOR ROLE core_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO core_app;
ALTER DEFAULT PRIVILEGES FOR ROLE core_migrator IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO core_app;
ALTER DEFAULT PRIVILEGES FOR ROLE core_migrator IN SCHEMA public
  GRANT SELECT ON TABLES TO core_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE core_migrator IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO core_readonly;
-- TRUNCATE / REFERENCES / TRIGGER are never granted to runtime roles.
SQL

read -r -a spokes <<<"${SPOKE_DATABASES:-}"
for spoke in "${spokes[@]}"; do
  valid_ident "$spoke" || die "invalid spoke identifier '$spoke'"
  var="$(echo "$spoke" | tr '[:lower:]' '[:upper:]')_DB_PASSWORD"
  pw="${!var:-}"
  [[ -n "$pw" ]] || die "$var is not set for spoke '$spoke'"
  valid_secret "$pw" || die "$var must be 32-256 alphanumeric characters"

  echo "[initdb] Creating spoke role + database: $spoke"
  psql_super --dbname postgres <<SQL
CREATE ROLE "${spoke}" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
  CONNECTION LIMIT 40 PASSWORD '${pw}';
ALTER ROLE "${spoke}" SET statement_timeout = '120s';
ALTER ROLE "${spoke}" SET idle_in_transaction_session_timeout = '60s';
CREATE DATABASE "${spoke}" OWNER "${spoke}" ENCODING 'UTF8' TEMPLATE template0;
REVOKE ALL ON DATABASE "${spoke}" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE "${spoke}" TO "${spoke}";
SQL
  psql_super --dbname "$spoke" <<SQL
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO "${spoke}";
SQL
done

echo "[initdb] Done."
