# ====================================================
# AI Platform - Vigia (watchdog)
# Roda periodicamente (via Tarefa Agendada do Windows) e verifica se
# Docker/API/Ollama/ComfyUI/tunel estao respondendo. So aciona o reinicio
# completo (iniciar-sistema.ps1) quando algo REALMENTE esta fora do ar -
# nao reinicia nada a toa quando ja esta tudo saudavel (isso derrubaria
# geracoes em andamento e trocaria a URL do tunel sem necessidade).
# Log cumulativo em logs\vigia.log (para auditoria/debug).
# ====================================================
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$ProgressPreference = 'SilentlyContinue'

$logDir = Join-Path $root "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir "vigia.log"

function Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - $msg"
    Add-Content -Path $logFile -Value $line
}

function Test-Url($url, $timeoutSec = 5) {
    try {
        $res = Invoke-WebRequest -Uri $url -TimeoutSec $timeoutSec -UseBasicParsing -ErrorAction Stop
        return $res.StatusCode -ge 200 -and $res.StatusCode -lt 500
    } catch { return $false }
}

function Test-DockerRunning {
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    try {
        docker version --format '{{.Server.Version}}' *> $null
        return $LASTEXITCODE -eq 0
    } catch { return $false } finally { $ErrorActionPreference = $prevEAP }
}

Log "--- checagem iniciada ---"

$problems = @()

if (-not (Test-DockerRunning)) { $problems += "Docker offline" }
elseif (-not (Test-Url "http://localhost:3000/v1/health")) { $problems += "API local offline" }

if (-not (Test-Url "http://localhost:11434/api/tags")) { $problems += "Ollama offline" }
if (-not (Test-Url "http://localhost:8188/system_stats")) { $problems += "ComfyUI offline" }

# ---------- Mantem o modelo padrao sempre carregado (evita cold-start) ----------
# OLLAMA_KEEP_ALIVE=30m descarrega o modelo da VRAM apos 30min sem uso. Se a
# primeira chamada real (do Lovable) chegar depois disso, o Ollama precisa
# recarregar do zero (10-15s+) antes de gerar - e isso pode facilmente
# estourar o timeout do Cloudflare/Lovable, resultando em 502/504 mesmo com
# tudo saudavel. Rodando a cada 5 min (bem dentro dos 30min de keep-alive),
# esse ping mantem o modelo sempre quente, sem custo real (gera 1 token).
if ($problems.Count -eq 0) {
    try {
        # Usa OLLAMA_FAST_MODEL, nao o DEFAULT - o Lovable sempre manda
        # task:"seo" nas chamadas de texto, que roteia pro modelo rapido.
        # So 1 modelo cabe na VRAM por vez (OLLAMA_MAX_LOADED_MODELS=1),
        # entao manter o DEFAULT quente so trocaria o cold-start de lugar.
        $envFileForModel = Join-Path $root ".env"
        $model = "qwen2.5:3b"
        if (Test-Path $envFileForModel) {
            $ml = Select-String -Path $envFileForModel -Pattern '^OLLAMA_FAST_MODEL=(.+)$' | Select-Object -First 1
            if ($ml) { $model = $ml.Matches[0].Groups[1].Value }
        }
        Invoke-RestMethod -Uri "http://localhost:11434/api/generate" -Method Post -TimeoutSec 60 -ContentType "application/json" `
            -Body (@{ model = $model; prompt = "oi"; stream = $false; options = @{ num_predict = 1 } } | ConvertTo-Json) | Out-Null
    } catch {
        Log "AVISO: ping de keep-warm do Ollama falhou: $($_.Exception.Message)"
    }
}

$tunnelFile = Join-Path $root "tunnel-url.txt"
$urlBefore = $null
if (Test-Path $tunnelFile) {
    $urlBefore = (Get-Content $tunnelFile -Raw -ErrorAction SilentlyContinue).Trim()
    if ($urlBefore -and -not (Test-Url "$urlBefore/v1/health" 8)) { $problems += "Tunel offline ($urlBefore)" }
} else {
    $problems += "Sem URL de tunel registrada"
}

if ($problems.Count -eq 0) {
    Log "OK - tudo respondendo"
    exit 0
}

Log "PROBLEMA detectado: $($problems -join '; ') - acionando iniciar-sistema.ps1"
try {
    & (Join-Path $PSScriptRoot "iniciar-sistema.ps1") -Silent *>> $logFile
    Log "iniciar-sistema.ps1 concluido"
} catch {
    Log "ERRO ao rodar iniciar-sistema.ps1: $($_.Exception.Message)"
}

# ---------- Avisa o Lovable se a URL do tunel mudou ----------
$urlAfter = $null
if (Test-Path $tunnelFile) { $urlAfter = (Get-Content $tunnelFile -Raw -ErrorAction SilentlyContinue).Trim() }

if ($urlAfter -and $urlAfter -ne $urlBefore) {
    $envFile = Join-Path $root ".env"
    $webhookUrl = $null; $secret = $null
    if (Test-Path $envFile) {
        $m1 = Select-String -Path $envFile -Pattern '^AI_WATCHDOG_WEBHOOK_URL=(.+)$' | Select-Object -First 1
        $m2 = Select-String -Path $envFile -Pattern '^AI_WATCHDOG_SECRET=(.+)$' | Select-Object -First 1
        if ($m1) { $webhookUrl = $m1.Matches[0].Groups[1].Value }
        if ($m2) { $secret = $m2.Matches[0].Groups[1].Value }
    }
    if ($webhookUrl -and $secret) {
        try {
            $body = @{ url = $urlAfter; secret = $secret; label = "vigia-auto" } | ConvertTo-Json
            Invoke-RestMethod -Uri $webhookUrl -Method Post -Body $body -ContentType "application/json" -TimeoutSec 15 | Out-Null
            Log "Lovable avisado da nova URL do tunel: $urlAfter"
        } catch {
            Log "ERRO ao avisar Lovable da nova URL: $($_.Exception.Message)"
        }
    } else {
        Log "URL do tunel mudou para $urlAfter mas AI_WATCHDOG_WEBHOOK_URL/SECRET nao configurados no .env - Lovable NAO foi avisado"
    }
}
