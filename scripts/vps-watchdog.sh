#!/usr/bin/env bash
set -uo pipefail

exec 9>/run/ai-platform-watchdog.lock
flock -n 9 || exit 0
cd /opt/ai-platform || exit 1

services=(postgres redis ollama comfyui api worker dashboard)
for service in "${services[@]}"; do
  container_id=$(docker compose --profile vps ps -q "$service" 2>/dev/null || true)
  if [ -z "$container_id" ]; then
    logger -t ai-platform-watchdog "service=$service missing; recreating"
    docker compose --profile vps up -d --no-deps "$service"
    continue
  fi
  state=$(docker inspect --format '{{.State.Status}}' "$container_id" 2>/dev/null || echo unknown)
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id" 2>/dev/null || echo unknown)
  if [ "$state" != running ] || [ "$health" = unhealthy ]; then
    logger -t ai-platform-watchdog "service=$service state=$state health=$health; restarting"
    docker restart --time 30 "$container_id" >/dev/null
  fi
done