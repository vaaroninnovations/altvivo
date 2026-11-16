# AltVivo edge proxy: Caddy + Cloudflare DNS-01 (wildcard TLS)
#                      + edge rate limiting + Cloudflare trusted-proxy ranges.
ARG CADDY_VERSION=2.10.0

FROM caddy:${CADDY_VERSION}-builder-alpine AS builder
# XCADDY_SETCAP=0: the builder image otherwise stamps cap_net_bind_service on
# the binary, and a binary with file capabilities cannot be exec'd under
# cap_drop: ALL + no-new-privileges ("exec caddy failed: Operation not permitted").
RUN XCADDY_SETCAP=0 xcaddy build \
      --with github.com/caddy-dns/cloudflare \
      --with github.com/mholt/caddy-ratelimit \
      --with github.com/WeidiDeng/caddy-cloudflare-ip

FROM caddy:${CADDY_VERSION}-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# Unprivileged runtime user. Port 80/443 binding is granted by the
# net.ipv4.ip_unprivileged_port_start sysctl in docker-compose.yml.
RUN addgroup -S -g 10001 caddysvc \
 && adduser -S -D -H -u 10001 -G caddysvc -s /sbin/nologin caddysvc \
 && mkdir -p /data /config /var/log/caddy /srv/embed /etc/caddy/spokes-enabled \
 && chown -R 10001:10001 /data /config /var/log/caddy \
 && caddy list-modules | grep -E '^(dns.providers.cloudflare|http.handlers.rate_limit|http.ip_sources.cloudflare)$' | wc -l | grep -qx 3

USER 10001:10001
EXPOSE 80 443 443/udp
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
