# ====================================================
# AI Platform - Instalacao no Windows
# Requisitos: Docker Desktop (https://docker.com)
# Opcional p/ desenvolvimento local: Node.js 22 (winget install OpenJS.NodeJS.LTS)
# ====================================================
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

Write-Host '== AI Platform - instalacao (Windows) ==' -ForegroundColor Cyan

# 1. Docker
$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
    Write-Host 'Docker nao encontrado. Instale o Docker Desktop: https://www.docker.com/products/docker-desktop/' -ForegroundColor Red
    exit 1
}

# 2. .env
if (-not (Test-Path '.env')) {
    Copy-Item '.env.example' '.env'
    Write-Host 'Arquivo .env criado a partir de .env.example - revise as chaves dos providers.' -ForegroundColor Yellow
}

# 3. Sobe a stack
Write-Host 'Construindo e subindo containers (postgres, redis, api, worker, dashboard)...' -ForegroundColor Cyan
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { Write-Host 'Falha no docker compose.' -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host '== Pronto! ==' -ForegroundColor Green
Write-Host '  API:        http://localhost:3000  (Swagger em /docs)'
Write-Host '  Dashboard:  http://localhost:8080  (ou http://localhost:3000/dashboard)'
Write-Host '  Login:      valores de ADMIN_EMAIL / ADMIN_PASSWORD do .env'
Write-Host '  API key:    valor de DEFAULT_API_KEY do .env (header x-api-key)'
Write-Host ''
Write-Host 'Monitoramento opcional: docker compose --profile monitoring up -d  (Prometheus :9090, Grafana :3001)'
