#!/usr/bin/env bash
# =============================================================================
# Toggle a spoke's public routing in Caddy without downtime.
#
#   ./scripts/spoke-route.sh enable  pharmadme   # proxy pharmadme.altvivo.bio -> pharmadme:8000
#   ./scripts/spoke-route.sh disable pharmadme   # back to "Launching Soon" holding page
#   ./scripts/spoke-route.sh status
#
# The Caddyfile is validated inside the running container before the reload;
# on failure the previous route files are restored.
#
# Routing (this script) and product status (app_registry.status, flipped in
# /workspace/admin/apps) are deliberately separate: an app can be LIVE in the
# registry while its container is being redeployed, and Caddy will show the
# maintenance page instead of an error.
# =============================================================================
set -Eeuo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

CADDY_DIR="$INFRA_DIR/caddy"
AVAILABLE="$CADDY_DIR/spokes-available"
ENABLED="$CADDY_DIR/spokes-enabled"
HOLDING="$CADDY_DIR/coming-soon.caddy"

action="${1:-}"
app="${2:-}"

holding_hosts() {
  grep -E '^@phase2 host ' "$HOLDING" | sed 's/^@phase2 host //' | tr ' ' '\n' | sed '/^$/d'
}

write_holding_hosts() {
  local tmp; tmp="$(mktemp "$HOLDING.XXXXXX")"
  if [[ -z "$*" ]]; then
    # Caddy needs at least one host; use an unroutable placeholder label.
    set -- "phase2-none.altvivo.bio"
  fi
  awk -v hosts="$*" '/^@phase2 host / {print "@phase2 host " hosts; next} {print}' "$HOLDING" >"$tmp"
  # Rewrite in place (keeps the inode stable for the container bind mount).
  cat "$tmp" >"$HOLDING"
  rm -f "$tmp"
}

validate_and_reload() {
  if ! dc exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null; then
    return 1
  fi
  dc exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
}

status() {
  local a
  printf '%-10s %-10s\n' APP ROUTE
  for a in "${KNOWN_APPS[@]}"; do
    if [[ -f "$ENABLED/$a.caddy" ]]; then printf '%-10s %-10s\n' "$a" proxied
    elif holding_hosts | grep -qx "$a.altvivo.bio"; then printf '%-10s %-10s\n' "$a" coming-soon
    else printf '%-10s %-10s\n' "$a" unrouted; fi
  done
}

case "$action" in
  status) status; exit 0 ;;
  enable|disable) ;;
  *) die "usage: $0 enable|disable <app_id> | status" ;;
esac

is_known_app "$app" || die "unknown app '$app' (known: ${KNOWN_APPS[*]})"
require_cmd docker
[[ -f "$AVAILABLE/$app.caddy" ]] || die "no route template $AVAILABLE/$app.caddy"

backup_dir="$(mktemp -d)"
trap 'rm -rf "$backup_dir"' EXIT
cp -p "$HOLDING" "$backup_dir/coming-soon.caddy"
[[ -f "$ENABLED/$app.caddy" ]] && cp -p "$ENABLED/$app.caddy" "$backup_dir/$app.caddy"

rollback() {
  warn "Caddy rejected the new config - rolling back"
  cp -p "$backup_dir/coming-soon.caddy" "$HOLDING"
  if [[ -f "$backup_dir/$app.caddy" ]]; then cp -p "$backup_dir/$app.caddy" "$ENABLED/$app.caddy"; else rm -f "$ENABLED/$app.caddy"; fi
  dc exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile || true
  exit 1
}

mapfile -t hosts < <(holding_hosts | grep -vx 'phase2-none.altvivo.bio' || true)

if [[ "$action" == "enable" ]]; then
  if ! dc ps --status running --services | grep -qx "$app"; then
    die "service '$app' is not running - uncomment it in docker-compose.yml and 'docker compose up -d $app' first"
  fi
  install -m 0644 "$AVAILABLE/$app.caddy" "$ENABLED/$app.caddy"
  mapfile -t hosts < <(printf '%s\n' "${hosts[@]}" | grep -vx "$app.altvivo.bio" || true)
  write_holding_hosts "${hosts[@]}"
  validate_and_reload || rollback
  log "$app.altvivo.bio is now proxied to $app:8000"
else
  rm -f "$ENABLED/$app.caddy"
  case "$app" in
    xprism|amaze) warn "$app is a Phase-1 LIVE app; its host will now show the holding page" ;;
  esac
  printf '%s\n' "${hosts[@]}" | grep -qx "$app.altvivo.bio" || hosts+=("$app.altvivo.bio")
  write_holding_hosts "${hosts[@]}"
  validate_and_reload || rollback
  log "$app.altvivo.bio now serves the Launching Soon page"
fi

status
