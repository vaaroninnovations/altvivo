#!/usr/bin/env bash
# =============================================================================
# AltVivo host firewall (Ubuntu 22.04 / 24.04).
#
#   sudo ./scripts/ufw-setup.sh                       # SSH + 80/443 from anywhere
#   sudo CLOUDFLARE_ONLY=1 ./scripts/ufw-setup.sh     # 80/443 only from Cloudflare edge
#   sudo SSH_ALLOW_FROM=203.0.113.7/32 ./scripts/ufw-setup.sh   # SSH only from admin IP
#   sudo SSH_PORT=2222 ./scripts/ufw-setup.sh
#
# Why the DOCKER-USER section matters: Docker publishes ports with DNAT in the
# nat table, so that traffic is FORWARDed and never traverses ufw's INPUT
# rules. The rules written to /etc/ufw/after.rules filter forwarded traffic in
# Docker's DOCKER-USER chain so that ONLY 80/tcp, 443/tcp and 443/udp can ever
# reach a container from the public interface - even if someone later adds a
# `ports:` entry to another service by mistake.
# =============================================================================
set -Eeuo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_root "$@"

CLOUDFLARE_ONLY="${CLOUDFLARE_ONLY:-0}"
SSH_ALLOW_FROM="${SSH_ALLOW_FROM:-any}"
MARK_BEGIN="# BEGIN ALTVIVO DOCKER-USER"
MARK_END="# END ALTVIVO DOCKER-USER"

detect_ssh_port() {
  local p=""
  if command -v sshd >/dev/null 2>&1; then
    p="$(sshd -T 2>/dev/null | awk '$1=="port"{print $2; exit}')"
  fi
  printf '%s' "${p:-22}"
}

SSH_PORT="${SSH_PORT:-$(detect_ssh_port)}"
[[ "$SSH_PORT" =~ ^[0-9]{1,5}$ ]] || die "invalid SSH_PORT '$SSH_PORT'"

EXT_IF="${EXT_IF:-$(ip -4 route show default | awk '{for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1); exit}}')}"
[[ -n "$EXT_IF" ]] || die "could not detect the public interface; set EXT_IF=eth0"
ip link show "$EXT_IF" >/dev/null 2>&1 || die "interface '$EXT_IF' does not exist"

valid_cidr4() { [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$ ]]; }
valid_cidr6() { [[ "$1" =~ ^[0-9a-fA-F:]+/[0-9]{1,3}$ ]]; }

CF_V4=()
CF_V6=()
if [[ "$CLOUDFLARE_ONLY" == "1" ]]; then
  require_cmd curl
  log "Fetching Cloudflare edge ranges"
  mapfile -t CF_V4 < <(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v4 | tr -d '\r' | sed '/^$/d')
  mapfile -t CF_V6 < <(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v6 | tr -d '\r' | sed '/^$/d')
  (( ${#CF_V4[@]} > 5 )) || die "Cloudflare IPv4 list looks wrong; aborting"
  for c in "${CF_V4[@]}"; do valid_cidr4 "$c" || die "bad Cloudflare v4 range: $c"; done
  for c in "${CF_V6[@]}"; do valid_cidr6 "$c" || die "bad Cloudflare v6 range: $c"; done
fi

if ! command -v ufw >/dev/null 2>&1; then
  log "Installing ufw"
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ufw
fi

# Keep IPv6 filtering on.
sed -i 's/^IPV6=.*/IPV6=yes/' /etc/default/ufw

log "Setting default policies"
ufw default deny incoming
ufw default allow outgoing
ufw logging low

# --- SSH first, so enabling the firewall can never lock us out ---------------
log "Allowing SSH on ${SSH_PORT}/tcp from ${SSH_ALLOW_FROM} (rate-limited)"
if [[ "$SSH_ALLOW_FROM" == "any" ]]; then
  ufw limit "${SSH_PORT}/tcp" comment 'AltVivo SSH'
else
  valid_cidr4 "$SSH_ALLOW_FROM" || valid_cidr6 "$SSH_ALLOW_FROM" || die "SSH_ALLOW_FROM must be a CIDR"
  ufw limit from "$SSH_ALLOW_FROM" to any port "$SSH_PORT" proto tcp comment 'AltVivo SSH (admin)'
fi

# --- Web (covers the INPUT path, e.g. docker userland-proxy) -----------------
if [[ "$CLOUDFLARE_ONLY" == "1" ]]; then
  log "Allowing 80/443 from Cloudflare only (${#CF_V4[@]} v4, ${#CF_V6[@]} v6 ranges)"
  # Remove any generic 80/443 allow rules from a previous non-CF run.
  ufw --force delete allow 80/tcp  >/dev/null 2>&1 || true
  ufw --force delete allow 443/tcp >/dev/null 2>&1 || true
  ufw --force delete allow 443/udp >/dev/null 2>&1 || true
  for c in "${CF_V4[@]}" "${CF_V6[@]}"; do
    ufw allow proto tcp from "$c" to any port 80,443 comment 'Cloudflare edge' >/dev/null
    ufw allow proto udp from "$c" to any port 443 comment 'Cloudflare edge (QUIC)' >/dev/null
  done
else
  ufw allow 80/tcp  comment 'AltVivo HTTP (ACME redirect)'
  ufw allow 443/tcp comment 'AltVivo HTTPS'
  ufw allow 443/udp comment 'AltVivo HTTP/3'
fi

# --- DOCKER-USER chain (the path Docker-published ports actually take) -------
write_docker_user_block() {
  local file="$1" family="$2" tmp c
  [[ -f "$file" ]] || die "$file not found (is ufw installed?)"
  cp -p "$file" "${file}.altvivo.bak"
  tmp="$(mktemp)"
  # Drop any previous AltVivo block.
  awk -v b="$MARK_BEGIN" -v e="$MARK_END" '
    $0==b {skip=1; next}
    $0==e {skip=0; next}
    !skip {print}' "$file" >"$tmp"

  {
    echo "$MARK_BEGIN"
    echo "*filter"
    echo ":DOCKER-USER - [0:0]"
    echo "-A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN"
    echo "-A DOCKER-USER ! -i ${EXT_IF} -j RETURN"
    if [[ "$CLOUDFLARE_ONLY" == "1" ]]; then
      local -a ranges
      if [[ "$family" == "4" ]]; then ranges=("${CF_V4[@]}"); else ranges=("${CF_V6[@]}"); fi
      for c in "${ranges[@]}"; do
        echo "-A DOCKER-USER -i ${EXT_IF} -s ${c} -p tcp -m multiport --dports 80,443 -j RETURN"
        echo "-A DOCKER-USER -i ${EXT_IF} -s ${c} -p udp --dport 443 -j RETURN"
      done
    else
      echo "-A DOCKER-USER -i ${EXT_IF} -p tcp -m multiport --dports 80,443 -j RETURN"
      echo "-A DOCKER-USER -i ${EXT_IF} -p udp --dport 443 -j RETURN"
    fi
    echo "-A DOCKER-USER -i ${EXT_IF} -m conntrack --ctstate NEW,INVALID -j DROP"
    echo "-A DOCKER-USER -j RETURN"
    echo "COMMIT"
    echo "$MARK_END"
  } >>"$tmp"

  install -m 0640 -o root -g root "$tmp" "$file"
  rm -f "$tmp"
}

log "Writing DOCKER-USER guard rules for interface ${EXT_IF}"
write_docker_user_block /etc/ufw/after.rules 4
write_docker_user_block /etc/ufw/after6.rules 6

log "Enabling ufw"
ufw --force enable
ufw reload

# Docker recreates its FORWARD jump on start; restart it if running so the
# DOCKER-USER chain is wired in immediately on hosts where ufw loaded first.
if systemctl is-active --quiet docker; then
  if iptables -C FORWARD -j DOCKER-USER >/dev/null 2>&1; then
    log "Docker FORWARD -> DOCKER-USER jump present"
  else
    warn "DOCKER-USER jump missing; restarting docker (containers with restart policy come back)"
    systemctl restart docker
  fi
fi

if [[ "$CLOUDFLARE_ONLY" == "1" ]]; then
  cat >/etc/cron.d/altvivo-cloudflare-ufw <<EOF
# Refresh Cloudflare edge ranges weekly (AltVivo)
SHELL=/bin/bash
17 4 * * 1 root CLOUDFLARE_ONLY=1 SSH_PORT=${SSH_PORT} SSH_ALLOW_FROM=${SSH_ALLOW_FROM} EXT_IF=${EXT_IF} ${INFRA_DIR}/scripts/ufw-setup.sh >>/var/log/altvivo-ufw.log 2>&1
EOF
  chmod 644 /etc/cron.d/altvivo-cloudflare-ufw
  log "Installed weekly Cloudflare range refresh (/etc/cron.d/altvivo-cloudflare-ufw)"
else
  rm -f /etc/cron.d/altvivo-cloudflare-ufw
fi

log "Firewall status:"
ufw status verbose
log "DOCKER-USER (IPv4):"
iptables -S DOCKER-USER 2>/dev/null || warn "DOCKER-USER not present yet (start docker)"
