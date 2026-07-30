#!/usr/bin/env bash
# ====================================================
# API Platform Enterprise v2.0 - VPS Bootstrap Script
# Instala Docker, Docker Compose, Nginx, Git, Node.js e
# inicializa a stack completa de infraestrutura universal de IA.
# ====================================================

set -e

echo "🚀 Iniciando Bootstrap da API Platform Enterprise v2.0..."

# Update system packages
sudo apt-get update -y
sudo apt-get upgrade -y
sudo apt-get install -y curl git ufw build-essential

# Install Docker if missing
if ! command -v docker &> /dev/null; then
    echo "📦 Instalando Docker..."
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker $USER
fi

# Install Docker Compose Plugin if missing
if ! docker compose version &> /dev/null; then
    echo "📦 Instalando Docker Compose..."
    sudo apt-get install -y docker-compose-plugin
fi

# Clone or verify directory
echo "📂 Verificando diretório do projeto..."
if [ ! -f "docker-compose.production.yml" ]; then
    echo "⚠️ Execute este script a partir da raiz do repositório API Platform."
    exit 1
fi

# Prepare .env file
if [ ! -f ".env" ]; then
    echo "📝 Criando .env inicial a partir de .env.example..."
    cp .env.example .env
fi

# Start Docker Stack
echo "⚡ Subindo os containers (PostgreSQL, Redis, API, Worker, Nginx)..."
docker compose -f docker-compose.production.yml up -d --build

echo "✅ BOOTSTRAP CONCLUÍDO COM SUCESSO!"
echo "----------------------------------------------------"
echo "API Gateway     : http://localhost:3000"
echo "OpenAI Compat   : http://localhost:3000/v1/chat/completions"
echo "Configuration   : http://localhost:3000/v1/config"
echo "Status Cluster  : http://localhost:3000/v1/sync/cluster"
echo "----------------------------------------------------"
