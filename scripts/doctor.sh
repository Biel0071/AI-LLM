#!/bin/bash
# API Platform Enterprise v5.0 - System Doctor Script

echo "=== API PLATFORM DOCTOR ==="
echo "Diagnosticando ambiente de VPS e Containers"
echo ""

echo "[1] MEMORIA DO SISTEMA"
free -h
echo ""

echo "[2] DOCKER CONTAINERS STATUS"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""

echo "[3] DOCKER RESOURCES"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"
echo ""

echo "[4] DISK USAGE"
df -h | grep -E '^/dev/|Filesystem'
echo ""

echo "[5] DATABASE CONNECTIVITY"
if docker compose exec -T postgres pg_isready -U apiplatform > /dev/null 2>&1; then
    echo "  > PostgreSQL: ONLINE"
else
    echo "  > PostgreSQL: OFFLINE ou inacessível!"
fi

if docker compose exec -T redis redis-cli ping > /dev/null 2>&1; then
    echo "  > Redis: ONLINE"
else
    echo "  > Redis: OFFLINE ou inacessível!"
fi
echo ""

echo "[6] WORKERS HEARTBEAT"
# Check worker heartbeat file age inside worker container
WORKER_ALIVE=$(docker compose exec -T worker sh -c "find /tmp/apiplatform-worker-heartbeat -mmin -2 2>/dev/null" || true)
if [ ! -z "$WORKER_ALIVE" ]; then
    echo "  > Worker Event Loop: RESPONSIVO (heartbeat recente)"
else
    echo "  > Worker Event Loop: ALERTA (heartbeat atrasado ou arquivo ausente)"
fi
echo ""

echo "=== DOCTOR FINISHED ==="
