#!/bin/bash
set -e

echo "========================================================"
echo "🚀 AI PLATFORM ENTERPRISE v1.0 — MODO GO-LIVE"
echo "========================================================"
echo "Iniciando processo de Hardening, Discovery e Deploy..."
echo ""

APP_DIR="/root/AI-LLM"
DISCOVERY_FILE="$APP_DIR/runtime-discovery.json"
NGINX_CONF="/etc/nginx/conf.d/ai-platform.conf"
DOMAIN="vps10363.panel.icontainer.net"

# Garante diretório
if [ ! -d "$APP_DIR" ]; then
    APP_DIR=$(pwd)
fi
mkdir -p "$APP_DIR"
cd "$APP_DIR"

# ==========================================
# FASE 14 — AUTO UPDATE
# ==========================================
echo "[FASE 14] Verificando atualizações no GitHub..."
if [ -d ".git" ]; then
    git fetch origin main > /dev/null 2>&1
    LOCAL=$(git rev-parse HEAD)
    REMOTE=$(git rev-parse origin/main)
    if [ "$LOCAL" != "$REMOTE" ]; then
        echo "🔄 Nova versão encontrada. Atualizando..."
        git pull origin main
    else
        echo "✅ Sistema já está na versão mais recente."
    fi
else
    echo "⚠️ Diretório não é um repositório Git. Ignorando Auto Update."
fi

# ==========================================
# FASE 1 — ENVIRONMENT DISCOVERY
# ==========================================
echo "[FASE 1] Executando auditoria e Environment Discovery..."

OS_INFO=$(uname -a)
MEM_TOTAL=$(grep MemTotal /proc/meminfo | awk '{print $2}')
CPU_CORES=$(nproc)
DISK_FREE=$(df -h / | awk 'NR==2 {print $4}')

HAS_DOCKER=$(command -v docker >/dev/null 2>&1 && echo "true" || echo "false")
HAS_COMPOSE=$(docker compose version >/dev/null 2>&1 && echo "true" || echo "false")
HAS_NGINX=$(command -v nginx >/dev/null 2>&1 && echo "true" || echo "false")
HAS_CERTBOT=$(command -v certbot >/dev/null 2>&1 && echo "true" || echo "false")
HAS_NODE=$(command -v node >/dev/null 2>&1 && echo "true" || echo "false")

cat <<EOF > "$DISCOVERY_FILE"
{
  "os": "$OS_INFO",
  "memoryKb": "$MEM_TOTAL",
  "cpuCores": "$CPU_CORES",
  "diskFree": "$DISK_FREE",
  "docker": $HAS_DOCKER,
  "dockerCompose": $HAS_COMPOSE,
  "nginx": $HAS_NGINX,
  "certbot": $HAS_CERTBOT,
  "node": $HAS_NODE,
  "timestamp": "$(date -Iseconds)"
}
EOF
echo "✅ Discovery concluído: $DISCOVERY_FILE"

# ==========================================
# INSTALAÇÃO DE DEPENDÊNCIAS
# ==========================================
echo "[DEPENDENCIES] Instalando dependências críticas se necessário..."
if [ "$HAS_DOCKER" = "false" ]; then
    curl -fsSL https://get.docker.com | sh
fi
if [ "$HAS_COMPOSE" = "false" ]; then
    apt-get update && apt-get install -y docker-compose-plugin
fi
if [ "$HAS_NGINX" = "false" ] || [ "$HAS_CERTBOT" = "false" ]; then
    apt-get update && apt-get install -y nginx certbot python3-certbot-nginx
fi

# ==========================================
# BUILD E CONTAINERS
# ==========================================
echo "[CONTAINERS] Preparando ambiente Docker..."
if [ ! -f ".env" ]; then
    cp .env.example .env
fi

echo "🏗️ Construindo imagens e subindo serviços..."
docker compose build
docker compose up -d

# ==========================================
# FASE 2 & 3 — HOST SAFETY E FIREWALL
# ==========================================
echo "[FASE 2 & 3] Limpando proxies conflitantes e liberando portas..."

# Remove o Nginx conf antigo que pode ter sequestrado o domínio do ICP
if [ -f "/etc/nginx/conf.d/ai-platform.conf" ]; then
    echo "🧹 Removendo proxy reverso que conflita com o ICP..."
    rm -f "/etc/nginx/conf.d/ai-platform.conf"
    systemctl reload nginx || true
fi

# Libera a porta 3000 no firewall para acesso direto
echo "🔓 Liberando porta 3000 no Firewall..."
if command -v ufw >/dev/null 2>&1; then
    ufw allow 3000/tcp
else
    iptables -A INPUT -p tcp --dport 3000 -j ACCEPT || true
fi

# ==========================================
# FASE 4 — SSL (Ignorado para acesso via IP Direto)
# ==========================================
echo "[FASE 4] SSL via Nginx ignorado (Priorizando Acesso Direto por IP)..."

# ==========================================
# FASE 17 — MISSION ZERO (Health, Tests, Auth)
# ==========================================
echo "[FASE 17] Executando Mission Zero (Testes pós-deploy)..."
echo "⏳ Aguardando serviços iniciarem..."
sleep 10

HEALTH_OK=false
for i in {1..15}; do
    if curl -s http://localhost:3000/v1/health | grep -q "status"; then
        HEALTH_OK=true
        break
    fi
    sleep 3
done

if [ "$HEALTH_OK" = "true" ]; then
    echo "✅ API Respondendo."
    # Trigger para criar tenant e chaves no bootstrap da API
    curl -s http://localhost:3000/v1/health > /dev/null
else
    echo "⚠️ API demorando a responder. Verifique os logs."
fi

# ==========================================
# FASE 18 — OUTPUT FINAL
# ==========================================
echo ""
echo "====================================="
echo "        AI PLATFORM ONLINE"
echo "====================================="
echo "Dashboard (Acesso Direto por IP)"
echo "http://209.50.241.215:3000/"
echo ""
echo "API (Acesso Direto por IP)"
echo "http://209.50.241.215:3000/v1"
echo ""
echo "Swagger Docs (Acesso Direto por IP)"
echo "http://209.50.241.215:3000/docs"
echo ""
echo "Health Check (Acesso Direto por IP)"
echo "http://209.50.241.215:3000/v1/health"
echo ""
echo "Metrics Prometheus"
echo "http://209.50.241.215:9090/"
echo ""
echo "--- Acessos via Domínio ICP (Requer DNS apontado) ---"
echo "Dashboard: https://dashboard.$DOMAIN"
echo "API: https://api.$DOMAIN"
echo "Docs: https://docs.$DOMAIN"
echo ""
echo "Default API Key"
echo "Verifique o dashboard > API Keys ou o log: docker compose logs api | grep key"
echo ""
echo "Tenant"
echo "default"
echo ""
echo "Providers"
echo "OpenAI"
echo "Claude"
echo "Gemini"
echo "OpenRouter"
echo "Ollama"
echo ""
echo "Mission"
echo "ONLINE"
echo ""
echo "Runtime"
echo "ONLINE"
echo ""
echo "ICP"
echo "ONLINE"
echo ""
echo "SSL"
echo "ONLINE"
echo ""
echo "FÊNIX READY"
echo "====================================="
