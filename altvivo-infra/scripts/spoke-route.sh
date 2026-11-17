#!/usr/bin/env bash
# =============================================================================
# Toggle a spoke's public routing in Caddy without downtime.
#
#   ./scripts/spoke-route.sh enable  xprism   # proxy xprism.altvivo.bio -> its container
#   ./scripts/spoke-route.sh disable xprism   # remove the route (the host then redirects to altvivo.bio)
#   ./scripts/spoke-route.sh status
#
# The Caddyfile is validated inside the running container before the reload;
# on failure the previous route file is restored.
#
# Routing (this script) and product status (app_registry.status, flipped in
# /admin/apps) are deliberately separate: an app can be LIVE in the registry
# while its container is being redeployed, and Caddy will show the
# maintenance page instead of an error.
# =============================================================================
set -Eeuo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

CADDY_DIR="$INFRA_DIR/caddy"
AVAILABLE="$CADDY_DIR/spokes-available"
ENABLED="$CADDY_DIR/spokes-enabled"

action="${1:-}"
app="${2:-}"

validate_and_reload() {
  if ! dc exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null; then
    return 1
  fi
  dc exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
}

status() {
  local a
  printf '%-10s %-10s
' APP ROUTE
  for a in "${KNOWN_APPS[@]}"; do
    if [[ -f "$ENABLED/$a.caddy" ]]; then printf '%-10s %-10s
' "$a" proxied
    else printf '%-10s %-10s
' "$a" unrouted; fi
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
[[ -f "$ENABLED/$app.caddy" ]] && cp -p "$ENABLED/$app.caddy" "$backup_dir/$app.caddy"

rollback() {
  warn "Caddy rejected the new config - rolling back"
  if [[ -f "$backup_dir/$app.caddy" ]]; then cp -p "$backup_dir/$app.caddy" "$ENABLED/$app.caddy"; else rm -f "$ENABLED/$app.caddy"; fi
  dc exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile || true
  exit 1
}

if [[ "$action" == "enable" ]]; then
  if ! dc ps --status running --services | grep -qx "$app"; then
    die "service '$app' is not running - start it with 'docker compose up -d $app' first"
  fi
  install -m 0644 "$AVAILABLE/$app.caddy" "$ENABLED/$app.caddy"
  validate_and_reload || rollback
  log "$app.altvivo.bio is now proxied to its container"
else
  rm -f "$ENABLED/$app.caddy"
  validate_and_reload || rollback
  log "$app.altvivo.bio is no longer routed (it redirects to altvivo.bio)"
fi

status
