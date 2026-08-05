#!/bin/bash
# API Platform Enterprise v5.0 - Health Check Script

echo "[API Platform] Iniciando validação de Health Check da API..."

MAX_ATTEMPTS=12
ATTEMPT=1
URL="http://127.0.0.1:3000/v1/health"

while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
    echo "  > Tentativa $ATTEMPT de $MAX_ATTEMPTS..."
    STATUS=$(curl -s $URL | grep -o '"status":"ONLINE"') || true
    
    if [ "$STATUS" == '"status":"ONLINE"' ]; then
        echo "[API Platform] SUCCESS: A API retornou status ONLINE!"
        exit 0
    fi
    
    sleep 5
    ((ATTEMPT++))
done

echo "[ERRO] Health check falhou após $MAX_ATTEMPTS tentativas. O container pode estar travado ou falhou no boot."
exit 1
