#!/usr/bin/env bash
# =============================================================================
# AltVivo secret material generator.
#
#   sudo ./scripts/generate-secrets.sh                 # first-time: .env, JWT keys, Redis ACL
#   sudo ./scripts/generate-secrets.sh --acl           # rebuild secrets/redis/users.acl from .env
#   sudo ./scripts/generate-secrets.sh --spoke <app>   # add secrets for a new spoke
#   sudo ./scripts/generate-secrets.sh --rotate-jwt    # new RS256 key, keep old one for verification
#
# Never overwrites an existing .env or key pair.
# =============================================================================
set -Eeuo pipefail
umask 077
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

JWT_DIR="$SECRETS_DIR/jwt"
REDIS_DIR="$SECRETS_DIR/redis"
BACKUP_DIR="$SECRETS_DIR/backup"

usage() { sed -n '3,12p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

jwt_kid() {
  openssl pkey -pubin -in "$1" -outform DER | sha256sum | cut -c1-32
}

fix_permissions() {
  chmod 700 "$SECRETS_DIR" "$JWT_DIR" "$REDIS_DIR" "$BACKUP_DIR"
  [[ -f "$ENV_FILE" ]] && chmod 600 "$ENV_FILE"
  if [[ -f "$JWT_DIR/private.pem" ]]; then
    chown "$UID_APP:$UID_APP" "$JWT_DIR/private.pem"
    chmod 400 "$JWT_DIR/private.pem"
  fi
  local f
  for f in "$JWT_DIR/public.pem" "$JWT_DIR/previous_public.pem"; do
    [[ -f "$f" ]] && { chown "$UID_APP:$UID_APP" "$f"; chmod 444 "$f"; }
  done
  if [[ -f "$REDIS_DIR/users.acl" ]]; then
    chown "$UID_REDIS:$GID_REDIS" "$REDIS_DIR/users.acl"
    chmod 400 "$REDIS_DIR/users.acl"
  fi
}

generate_jwt_keypair() {
  local priv="$1" pub="$2"
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$priv" 2>/dev/null
  openssl pkey -in "$priv" -pubout -out "$pub"
}

render_env() {
  [[ -f "$INFRA_DIR/.env.example" ]] || die ".env.example missing"
  if [[ -f "$ENV_FILE" ]]; then
    log ".env already exists - leaving it untouched"
    return
  fi
  local kid="$1" tmp line
  tmp="$(mktemp "$INFRA_DIR/.env.XXXXXX")"
  while IFS= read -r line || [[ -n "$line" ]]; do
    while [[ "$line" == *__GEN_HEX__* ]]; do line="${line/__GEN_HEX__/$(rand_hex 32)}"; done
    while [[ "$line" == *__GEN_B64__* ]]; do line="${line/__GEN_B64__/$(rand_b64 32)}"; done
    line="${line/__GEN_KID__/$kid}"
    printf '%s\n' "$line"
  done <"$INFRA_DIR/.env.example" >"$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$ENV_FILE"
  if [[ -n "${SUDO_UID:-}" ]]; then chown "$SUDO_UID:${SUDO_GID:-$SUDO_UID}" "$ENV_FILE"; fi
  log "Wrote $ENV_FILE (mode 600)"
}

acl_hash() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }

render_redis_acl() {
  [[ -f "$ENV_FILE" ]] || die ".env not found; run without flags first"
  local out="$REDIS_DIR/users.acl" tmp pw spoke var
  tmp="$(mktemp "$REDIS_DIR/users.acl.XXXXXX")"

  pw="$(env_get REDIS_CORE_PASSWORD)" || die "REDIS_CORE_PASSWORD missing in .env"
  {
    # No header line: Redis refuses to start on an ACL file that contains comments.
    echo "user default off resetkeys resetchannels -@all"
    # Hub: full data-plane access to its own namespace, no admin/dangerous commands.
    echo "user core on #$(acl_hash "$pw") resetkeys ~core:* resetchannels &core:* -@all +@all -@dangerous +info"

    read -r -a spokes <<<"$(env_get REDIS_SPOKES || echo "xprism")"
    for spoke in "${spokes[@]}"; do
      is_known_app "$spoke" || die "REDIS_SPOKES contains unknown app '$spoke'"
      var="REDIS_$(upper "$spoke")_PASSWORD"
      pw="$(env_get "$var")" || die "$var missing in .env"
      # Spokes: own namespace + READ-ONLY view of core revocation list and app
      # registry cache + subscribe to core broadcast channels.
      echo "user $spoke on #$(acl_hash "$pw") resetkeys ~${spoke}:* %R~core:revoked:* %R~core:registry:* resetchannels &${spoke}:* &core:broadcast:* -@all +@all -@dangerous +info"
    done

    pw="$(env_get REDIS_BACKUP_PASSWORD)" || die "REDIS_BACKUP_PASSWORD missing in .env"
    echo "user backup on #$(acl_hash "$pw") resetkeys resetchannels -@all +ping +bgsave +lastsave +info"
  } >"$tmp"
  mv -f "$tmp" "$out"
  fix_permissions
  log "Wrote $out"
}

add_spoke() {
  local app="$1" key current
  is_known_app "$app" || die "unknown app '$app' (known: ${KNOWN_APPS[*]})"
  [[ -f "$ENV_FILE" ]] || die ".env not found; run without flags first"
  for key in "$(upper "$app")_DB_PASSWORD" "REDIS_$(upper "$app")_PASSWORD" "$(upper "$app")_SERVICE_TOKEN"; do
    if env_get "$key" >/dev/null; then
      log "$key already present"
    else
      env_set "$key" "$(rand_hex 32)"
      log "Added $key"
    fi
  done
  current="$(env_get REDIS_SPOKES || echo "xprism")"
  if [[ " $current " != *" $app "* ]]; then
    env_set REDIS_SPOKES "$current $app"
    log "Added $app to REDIS_SPOKES"
  fi
  render_redis_acl
  cat <<EOF

Next steps for '$app':
  1. ./scripts/provision-spoke-db.sh $app
  2. docker compose restart redis           (loads the new ACL user)
  3. Append ,$app:\${$(upper "$app")_SERVICE_TOKEN} to SPOKE_SERVICE_TOKENS in docker-compose.yml
  4. Uncomment the '$app' service block, then: docker compose up -d altvivo-core $app
  5. ./scripts/spoke-route.sh enable $app
EOF
}

rotate_jwt() {
  [[ -f "$JWT_DIR/private.pem" ]] || die "no existing key pair to rotate"
  local stamp; stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  cp -p "$JWT_DIR/private.pem" "$JWT_DIR/private.$stamp.pem.retired"
  chmod 400 "$JWT_DIR/private.$stamp.pem.retired"
  cp -f "$JWT_DIR/public.pem" "$JWT_DIR/previous_public.pem"
  rm -f "$JWT_DIR/private.pem"
  generate_jwt_keypair "$JWT_DIR/private.pem" "$JWT_DIR/public.pem"
  env_set JWT_KID "$(jwt_kid "$JWT_DIR/public.pem")"
  fix_permissions
  log "Rotated RS256 key. New kid: $(env_get JWT_KID)"
  log "Apply with: docker compose up -d --force-recreate altvivo-core"
  log "JWKS now publishes the new and previous keys; tokens signed with the old"
  log "key keep verifying until they expire (15 min). Retired private key kept as"
  log "private.$stamp.pem.retired - shred it once you no longer need it."
}

first_run() {
  mkdir -p "$JWT_DIR" "$REDIS_DIR" "$BACKUP_DIR"
  if [[ -f "$JWT_DIR/private.pem" ]]; then
    log "JWT key pair already exists - keeping it"
  else
    generate_jwt_keypair "$JWT_DIR/private.pem" "$JWT_DIR/public.pem"
    cp -f "$JWT_DIR/public.pem" "$JWT_DIR/previous_public.pem"
    log "Generated RS256 (3072-bit) key pair in $JWT_DIR"
  fi
  render_env "$(jwt_kid "$JWT_DIR/public.pem")"
  render_redis_acl
  fix_permissions

  if [[ ! -s "$BACKUP_DIR/age_recipients.txt" ]]; then
    cat <<'EOF'

ACTION REQUIRED - backup encryption key
  On a trusted machine that is NOT this server:
      age-keygen -o altvivo-backup.key        # keep this file offline (password manager / HSM)
  Copy ONLY the printed "Public key: age1..." line into:
      secrets/backup/age_recipients.txt
  Backups are encrypted to that public key; this server can never decrypt them.
EOF
  fi
  cat <<'EOF'

Fill in the blank third-party credentials in .env (Cloudflare, Turnstile,
Stripe, Razorpay, R2, SMTP, OAuth) before `docker compose up -d`.
EOF
}

main() {
  require_root "$@"
  require_cmd openssl sha256sum awk
  mkdir -p "$SECRETS_DIR" "$JWT_DIR" "$REDIS_DIR" "$BACKUP_DIR"
  case "${1:-}" in
    "")            first_run ;;
    --acl)         render_redis_acl ;;
    --spoke)       [[ -n "${2:-}" ]] || usage 1; add_spoke "$2" ;;
    --rotate-jwt)  rotate_jwt ;;
    -h|--help)     usage 0 ;;
    *)             usage 1 ;;
  esac
}

main "$@"
