# ====================================================
# AI Platform - Parar sistema (Windows)
# Para os containers Docker. Ollama e ComfyUI (fora do Docker) ficam de fora
# de proposito - feche as janelas deles manualmente se quiser liberar CPU/GPU.
# ====================================================
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

Write-Host "Parando containers (postgres, redis, api, worker, dashboard)..." -ForegroundColor Cyan
docker compose stop

Write-Host ""
Write-Host "Containers parados. Dados (banco, cache, imagens) continuam salvos." -ForegroundColor Green
Write-Host "Para subir de novo: scripts\iniciar-sistema.ps1 (ou INICIAR.bat na raiz)."
Write-Host ""
Write-Host "Ollama e ComfyUI continuam rodando (sao apps do Windows, nao do Docker)." -ForegroundColor Yellow
Write-Host "Feche as janelas deles manualmente se quiser parar tambem."
