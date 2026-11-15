#!/usr/bin/env bash
# Shared helpers for AltVivo ops scripts. Source, do not execute.
# shellcheck disable=SC2034

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$INFRA_DIR/.env}"
SECRETS_DIR="$INFRA_DIR/secrets"
COMPOSE_FILE="$INFRA_DIR/docker-compose.yml"

# UIDs baked into the container images.
UID_APP=10001      # caddy, altvivo-core, altvivo-web, spokes
UID_REDIS=999
GID_REDIS=1000

KNOWN_APPS=(xprism amaze pharmadme stat phytonet mira)

log()  { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
warn() { printf '[%s] WARN: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
die()  { printf '[%s] ERROR: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; exit 1; }

require_root() { [[ $EUID -eq 0 ]] || die "run as root (sudo $0 $*)"; }

require_cmd() {
  local c
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || die "required command not found: $c"
  done
}

# Read KEY from .env without executing it (values may contain quotes, ;, $).
env_get() {
  local key="$1" file="${2:-$ENV_FILE}" line val
  [[ -f "$file" ]] || return 1
  line="$(grep -E "^${key}=" "$file" | tail -n 1 || true)"
  [[ -n "$line" ]] || return 1
  val="${line#*=}"
  if [[ "$val" =~ ^\"(.*)\"$ ]]; then val="${BASH_REMATCH[1]}";
  elif [[ "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
  printf '%s' "$val"
}

# Set or append KEY=VALUE in .env (value is written verbatim).
env_set() {
  local key="$1" value="$2" file="${3:-$ENV_FILE}" tmp
  tmp="$(mktemp "${file}.XXXXXX")"
  if grep -qE "^${key}=" "$file"; then
    awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' "$file" >"$tmp"
  else
    cat "$file" >"$tmp"
    printf '%s=%s\n' "$key" "$value" >>"$tmp"
  fi
  chmod --reference="$file" "$tmp" 2>/dev/null || chmod 600 "$tmp"
  chown --reference="$file" "$tmp" 2>/dev/null || true
  mv -f "$tmp" "$file"
}

rand_hex() { openssl rand -hex "${1:-32}"; }
rand_b64() { openssl rand -base64 "${1:-32}" | tr -d '\n'; }

upper() { printf '%s' "$1" | tr '[:lower:]' '[:upper:]'; }

is_known_app() {
  local a
  for a in "${KNOWN_APPS[@]}"; do [[ "$a" == "$1" ]] && return 0; done
  return 1
}

dc() { docker compose --project-directory "$INFRA_DIR" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }
