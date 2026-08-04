#!/bin/bash
# API PLATFORM ENTERPRISE v2.0 - CLI
# Command-line interface for the Universal API Platform

set -e

# ==============================================================================
# CONSTANTS & COLORS
# ==============================================================================
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

RUNTIME_FILE="runtime.json"
DISCOVERY_FILE="runtime-discovery.json"
ENV_FILE=".env"
COMPOSE_OVERRIDE="docker-compose.override.yml"

print_header() {
    echo -e "${BLUE}======================================================${NC}"
    echo -e "${BLUE}       API PLATFORM ENTERPRISE v2.0 - CLI            ${NC}"
    echo -e "${BLUE}======================================================${NC}"
}

# ==============================================================================
# UTILS
# ==============================================================================
find_free_port() {
    local port=$1
    while ss -tuln | grep -q ":$port " || netstat -tuln 2>/dev/null | grep -q ":$port "; do
        port=$((port + 1))
    done
    echo $port
}

# ==============================================================================
# MODULE: DISCOVERY & ADAPTERS
# ==============================================================================
discover_host() {
    echo -e "\n${YELLOW}[+] Performing Environment Discovery...${NC}"
    
    OS=$(uname -s)
    LINUX_DISTRO="Unknown"
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        LINUX_DISTRO=$PRETTY_NAME
    fi
    
    CPU_CORES=$(nproc 2>/dev/null || echo 1)
    TOTAL_RAM=$(free -m 2>/dev/null | awk '/^Mem:/{print $2}' || echo 0)
    
    HAS_DOCKER=$(command -v docker >/dev/null 2>&1 && echo "true" || echo "false")
    HAS_DOCKER_COMPOSE=$(command -v docker-compose >/dev/null 2>&1 && echo "true" || echo "false")
    if [ "$HAS_DOCKER_COMPOSE" = "false" ]; then
        HAS_DOCKER_COMPOSE=$(docker compose version >/dev/null 2>&1 && echo "true" || echo "false")
    fi
    
    HAS_NGINX=$(command -v nginx >/dev/null 2>&1 && echo "true" || echo "false")
    HAS_APACHE=$(command -v apache2 >/dev/null 2>&1 && echo "true" || echo "false")
    
    # Platform Adapters Detection
    PLATFORM_ADAPTER="pure"
    if [ -d "/usr/local/icp" ] || systemctl is-active --quiet icp-panel 2>/dev/null; then
        PLATFORM_ADAPTER="icp"
    elif [ -d "/usr/local/CyberCP" ]; then
        PLATFORM_ADAPTER="cyberpanel"
    elif [ -d "/www/server/panel" ]; then
        PLATFORM_ADAPTER="aapanel"
    elif [ -d "/usr/local/psa" ]; then
        PLATFORM_ADAPTER="plesk"
    elif [ -d "/usr/local/cpanel" ]; then
        PLATFORM_ADAPTER="cpanel"
    elif [ "$HAS_NGINX" = "true" ]; then
        PLATFORM_ADAPTER="nginx_pure"
    elif [ "$HAS_APACHE" = "true" ]; then
        PLATFORM_ADAPTER="apache_pure"
    fi

    cat <<EOF > $DISCOVERY_FILE
{
  "os": "$OS",
  "distro": "$LINUX_DISTRO",
  "cpu_cores": $CPU_CORES,
  "total_ram_mb": $TOTAL_RAM,
  "docker": $HAS_DOCKER,
  "docker_compose": $HAS_DOCKER_COMPOSE,
  "platform_adapter": "$PLATFORM_ADAPTER",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
    echo -e "${GREEN}✓ Discovery complete. Adapter detected: $PLATFORM_ADAPTER${NC}"
}

# ==============================================================================
# MODULE: PERSISTENT PORTS & RUNTIME
# ==============================================================================
allocate_ports() {
    if grep -q '"ports"' $RUNTIME_FILE 2>/dev/null; then
        echo -e "${GREEN}✓ Existing ports found in $RUNTIME_FILE. Reusing to avoid breakage.${NC}"
        # Extract using simple grep/awk (assuming jq might not be installed)
        PORT_API=$(grep -A 5 '"ports"' $RUNTIME_FILE | grep '"api"' | awk -F: '{print $2}' | tr -d ' ,')
        PORT_DASHBOARD=$(grep -A 5 '"ports"' $RUNTIME_FILE | grep '"dashboard"' | awk -F: '{print $2}' | tr -d ' ,')
        PORT_POSTGRES=$(grep -A 5 '"ports"' $RUNTIME_FILE | grep '"postgres"' | awk -F: '{print $2}' | tr -d ' ,')
        PORT_REDIS=$(grep -A 5 '"ports"' $RUNTIME_FILE | grep '"redis"' | awk -F: '{print $2}' | tr -d ' ,')
    else
        echo -e "${YELLOW}[+] Allocating Free Ports...${NC}"
        PORT_API=$(find_free_port 3000)
        PORT_DASHBOARD=$(find_free_port 8081)
        PORT_POSTGRES=$(find_free_port 5432)
        PORT_REDIS=$(find_free_port 6379)
        
        cat <<EOF > $RUNTIME_FILE
{
  "version": "2.0",
  "install_date": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "ports": {
    "api": $PORT_API,
    "dashboard": $PORT_DASHBOARD,
    "postgres": $PORT_POSTGRES,
    "redis": $PORT_REDIS
  }
}
EOF
        echo -e "${GREEN}✓ Ports allocated and saved to $RUNTIME_FILE${NC}"
    fi
}

configure_env() {
    if [ ! -f "$ENV_FILE" ]; then
        cp .env.example $ENV_FILE 2>/dev/null || touch $ENV_FILE
        echo "JWT_SECRET=$(openssl rand -hex 32)" >> $ENV_FILE
        echo "ADMIN_API_KEY=api-$(openssl rand -hex 16)" >> $ENV_FILE
        echo -e "${GREEN}✓ Generated Secrets in $ENV_FILE${NC}"
    fi

    cat <<EOF > $COMPOSE_OVERRIDE
services:
  api:
    ports:
      - "$PORT_API:3000"
  dashboard:
    ports:
      - "$PORT_DASHBOARD:80"
  postgres:
    ports:
      - "$PORT_POSTGRES:5432"
  redis:
    ports:
      - "$PORT_REDIS:6379"
EOF
    echo -e "${GREEN}✓ Configured docker-compose.override.yml${NC}"
}

# ==============================================================================
# COMMANDS
# ==============================================================================
cmd_deploy() {
    print_header
    discover_host
    allocate_ports
    configure_env
    
    echo -e "\n${YELLOW}[+] Deploying API Platform Enterprise...${NC}"
    if docker compose version >/dev/null 2>&1; then
        docker compose up -d --build
    else
        docker-compose up -d --build
    fi
    
    echo -e "\n${GREEN}✓ DEPLOYED SUCCESSFULLY${NC}"
    echo -e "Dashboard URL:   http://localhost:$PORT_DASHBOARD"
    echo -e "API Gateway:     http://localhost:$PORT_API/v1"
}

cmd_doctor() {
    print_header
    echo -e "${YELLOW}[+] Running Systems Check...${NC}"
    
    # Check Docker
    if command -v docker >/dev/null 2>&1; then
        echo -e "Docker: ${GREEN}OK${NC} ($(docker --version))"
    else
        echo -e "Docker: ${RED}FAILED${NC} (Not installed)"
    fi
    
    # Check Containers
    for container in api dashboard postgres redis worker; do
        if docker ps | grep -q "api-platform-$container"; then
            echo -e "Container $container: ${GREEN}RUNNING${NC}"
        else
            echo -e "Container $container: ${YELLOW}STOPPED/NOT FOUND${NC}"
        fi
    done
    
    # Check Memory
    TOTAL_RAM=$(free -m 2>/dev/null | awk '/^Mem:/{print $2}' || echo 0)
    if [ "$TOTAL_RAM" -lt 2000 ]; then
        echo -e "RAM: ${YELLOW}WARNING${NC} ($TOTAL_RAM MB) - Recommended 4GB+"
    else
        echo -e "RAM: ${GREEN}OK${NC} ($TOTAL_RAM MB)"
    fi
}

cmd_update() {
    print_header
    echo -e "${YELLOW}[+] Initiating Self Update Flow...${NC}"
    
    echo "1. Pulling latest code..."
    git pull origin main || echo -e "${YELLOW}Not a git repository or pull failed.${NC}"
    
    # echo "2. Creating Backup..."
    # ./api-platform.sh backup
    
    echo "3. Rebuilding containers..."
    if docker compose version >/dev/null 2>&1; then
        docker compose up -d --build
    else
        docker-compose up -d --build
    fi
    
    echo -e "${GREEN}✓ Update Complete!${NC}"
}

cmd_status() {
    print_header
    if docker compose version >/dev/null 2>&1; then
        docker compose ps
    else
        docker-compose ps
    fi
}

# ==============================================================================
# MAIN ROUTER
# ==============================================================================
case "$1" in
    deploy)
        cmd_deploy
        ;;
    doctor)
        cmd_doctor
        ;;
    update)
        cmd_update
        ;;
    status)
        cmd_status
        ;;
    *)
        echo "Usage: ./api-platform.sh {deploy|doctor|update|status|rollback|repair}"
        exit 1
        ;;
esac
