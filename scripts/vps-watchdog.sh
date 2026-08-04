#!/usr/bin/env bash
set -uo pipefail

exec 9>/run/api-platform-watchdog.lock
flock -n 9 || exit 0
cd /opt/api-platform || exit 1

services=(postgres redis ollama comfyui api worker dashboard)
for service in "${services[@]}"; do
  container_id=$(docker compose --profile vps ps -q "$service" 2>/dev/null || true)
  if [ -z "$container_id" ]; then
    logger -t api-platform-watchdog "service=$service missing; recreating"
    docker compose --profile vps up -d --no-deps "$service"
    continue
  fi
  state=$(docker inspect --format '{{.State.Status}}' "$container_id" 2>/dev/null || echo unknown)
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id" 2>/dev/null || echo unknown)
  if [ "$state" != running ] || [ "$health" = unhealthy ]; then
    logger -t api-platform-watchdog "service=$service state=$state health=$health; restarting"
    docker restart --time 30 "$container_id" >/dev/null
  fi
done

# Reaplica o isolamento da porta 3000 se a regra sumiu. A chain DOCKER-USER e
# recriada VAZIA pelo Docker a cada reboot/restart do daemon - sem isto, a 3000
# reabriria pra internet apos um reboot. Idempotente: so age se o DROP sumiu.
if command -v iptables >/dev/null 2>&1; then
  if ! iptables -C DOCKER-USER -p tcp --dport 3000 -m comment --comment 'api_platform_GW_3000' -j DROP 2>/dev/null; then
    logger -t api-platform-watchdog "port-3000 firewall rule missing; reapplying"
    iptables -I DOCKER-USER -p tcp --dport 3000 -s 127.0.0.1 -m comment --comment 'api_platform_GW_3000' -j RETURN 2>/dev/null || true
    for src in $(grep -E '^api_platform_ALLOWED_SOURCES=' .env 2>/dev/null | cut -d= -f2- | tr ',' ' '); do
      [ -n "$src" ] && iptables -I DOCKER-USER -p tcp --dport 3000 -s "$src" -m comment --comment 'api_platform_GW_3000' -j RETURN 2>/dev/null || true
    done
    iptables -A DOCKER-USER -p tcp --dport 3000 -m comment --comment 'api_platform_GW_3000' -j DROP 2>/dev/null || true
  fi
fi