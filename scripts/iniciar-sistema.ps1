# ====================================================
# AI Platform - Iniciar sistema completo (Windows)
# Sobe Docker (api/worker/postgres/redis/dashboard) + Ollama + ComfyUI,
# espera tudo responder e mostra a URL/API key prontas para uso.
# Seguro rodar de novo a qualquer momento (idempotente).
# ====================================================
param([switch]$Silent)
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

# Invoke-WebRequest renderiza uma barra de progresso a cada chunk por padrao -
# isso fica MUITO lento (as vezes trava por minutos) quando a saida esta
# redirecionada/nao-interativa, como quando este script roda em segundo plano.
$ProgressPreference = 'SilentlyContinue'

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK  - $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    !!  - $msg" -ForegroundColor Yellow }

function Test-Url($url, $timeoutSec = 2) {
    try {
        $res = Invoke-WebRequest -Uri $url -TimeoutSec $timeoutSec -UseBasicParsing -ErrorAction Stop
        return $res.StatusCode -ge 200 -and $res.StatusCode -lt 500
    } catch { return $false }
}

function Wait-Url($url, $label, $maxSeconds = 120) {
    $elapsed = 0
    while ($elapsed -lt $maxSeconds) {
        if (Test-Url $url) { Write-Ok "$label respondendo"; return $true }
        Start-Sleep -Seconds 3
        $elapsed += 3
        Write-Host "    ... aguardando $label ($elapsed s)" -ForegroundColor DarkGray
    }
    Write-Warn "$label nao respondeu em ${maxSeconds}s (siga em frente, verifique depois)"
    return $false
}

# Comandos nativos (docker.exe) escrevem em stderr mesmo quando dao certo;
# com $ErrorActionPreference padrao (Continue) isso nao devera lancar excecao,
# mas isolamos em SilentlyContinue mesmo assim para nunca derrubar o script.
function Test-DockerRunning {
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    try {
        docker version --format '{{.Server.Version}}' *> $null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    } finally {
        $ErrorActionPreference = $prevEAP
    }
}

Write-Host ""
Write-Host "########################################################" -ForegroundColor Magenta
Write-Host "#              AI PLATFORM - INICIANDO                 #" -ForegroundColor Magenta
Write-Host "########################################################" -ForegroundColor Magenta

# ---------- 1. Docker Desktop ----------
Write-Step "Verificando Docker Desktop"
$dockerUp = Test-DockerRunning

if (-not $dockerUp) {
    Write-Warn "Docker nao esta rodando. Abrindo Docker Desktop..."
    $dockerExe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dockerExe) {
        Start-Process -FilePath $dockerExe
        $elapsed = 0
        while ($elapsed -lt 90) {
            if (Test-DockerRunning) { $dockerUp = $true; break }
            Start-Sleep -Seconds 3; $elapsed += 3
            Write-Host "    ... aguardando Docker Desktop subir ($elapsed s)" -ForegroundColor DarkGray
        }
    } else {
        Write-Warn "Nao encontrei o Docker Desktop em '$dockerExe'. Abra manualmente e rode este script de novo."
    }
}
if ($dockerUp) { Write-Ok "Docker Desktop online" } else { Write-Warn "Docker nao respondeu - a stack (API/worker/dashboard) nao vai subir" }

# ---------- 2. Stack Docker (api/worker/postgres/redis/dashboard) ----------
if ($dockerUp) {
    Write-Step "Subindo containers (postgres, redis, api, worker, dashboard)"
    if (-not (Test-Path ".env")) { Copy-Item ".env.example" ".env"; Write-Warn "Criei .env a partir de .env.example - revise as chaves dos providers." }
    docker compose up -d 2>&1 | Write-Host
    if ($LASTEXITCODE -ne 0) { Write-Warn "docker compose up -d retornou erro - veja o log acima" }
    else { Write-Ok "Containers no ar" }
}

# ---------- 3. Ollama ----------
# Sempre reinicia com as variaveis certas nesta MESMA sessao do PowerShell -
# setar via [Environment]::SetEnvironmentVariable(...,"User") sozinho NAO e
# suficiente: um processo filho desta sessao nao le mudancas no registro feitas
# por ela mesma, entao "ollama app.exe" nao herdaria os valores corretos.
Write-Step "Reiniciando Ollama com configuracao otimizada (RAM/velocidade/paralelismo)"
$ollamaApp = "$env:LOCALAPPDATA\Programs\Ollama\ollama app.exe"
if (Test-Path $ollamaApp) {
    Stop-Process -Name "ollama app" -Force -ErrorAction SilentlyContinue
    Stop-Process -Name "ollama" -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    $numParallel = "5"
    $envFileForOllama = Join-Path $root ".env"
    if (Test-Path $envFileForOllama) {
        $line = Select-String -Path $envFileForOllama -Pattern '^OLLAMA_NUM_PARALLEL=(.+)$' | Select-Object -First 1
        if ($line) { $numParallel = $line.Matches[0].Groups[1].Value }
    }
    $env:OLLAMA_KEEP_ALIVE = "30m"          # nao recarrega o modelo entre requests espacados
    $env:OLLAMA_MAX_LOADED_MODELS = "1"     # nunca mais de 1 modelo na RAM ao mesmo tempo
    $env:OLLAMA_NUM_PARALLEL = $numParallel # precisa bater com o .env (semaforo do container usa o mesmo valor)
    Start-Process -FilePath $ollamaApp
    Wait-Url "http://localhost:11434/api/tags" "Ollama" 60 | Out-Null
} else {
    Write-Warn "Ollama nao encontrado em '$ollamaApp'. Instale ou inicie manualmente."
}

# ---------- 4. ComfyUI ----------
Write-Step "Verificando ComfyUI"
if (Test-Url "http://localhost:8188/system_stats") {
    Write-Ok "ComfyUI ja estava online"
} else {
    # Antes de subir um processo novo, mata qualquer python.exe orfao do
    # ComfyUI que tenha travado/crashado sem liberar a porta 8188 - sem essa
    # limpeza, "offline" pode significar "travado, nao morto", e um SEGUNDO
    # processo sobe em cima do primeiro, os dois brigam pela porta e nenhum
    # responde direito (foi exatamente o que causou falhas de imagem em
    # cascata). So mata processos cujo caminho de execucao e do ComfyUI -
    # nunca mata python.exe de outros projetos rodando na maquina.
    Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.ExecutablePath -and $_.ExecutablePath -like '*ComfyUI*' } |
        ForEach-Object {
            Write-Warn "Matando processo ComfyUI orfao (PID $($_.ProcessId))"
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
    Start-Sleep -Seconds 2
    $comfyBat = "C:\Users\Dell\ComfyUI\ComfyUI_windows_portable\run_nvidia_gpu.bat"
    if (Test-Path $comfyBat) {
        Write-Warn "ComfyUI offline. Iniciando em segundo plano (pode levar 1-2 min na primeira vez)..."
        $comfyDir = Split-Path $comfyBat -Parent
        $logFile = Join-Path $comfyDir "comfyui.log"
        Start-Process -FilePath $comfyBat -WorkingDirectory $comfyDir -WindowStyle Minimized `
            -RedirectStandardOutput $logFile -RedirectStandardError "$logFile.err"
        Wait-Url "http://localhost:8188/system_stats" "ComfyUI" 210 | Out-Null
    } else {
        Write-Warn "ComfyUI nao encontrado em '$comfyBat'. Pulei essa etapa."
    }
}

# ---------- 5. API da plataforma ----------
if ($dockerUp) {
    Write-Step "Aguardando a API da plataforma"
    Wait-Url "http://localhost:3000/v1/health" "API (porta 3000)" 60 | Out-Null
}

# ---------- 6. Tunel publico (Cloudflare) ----------
# Quick Tunnel do cloudflared: URL aleatoria *.trycloudflare.com, sem precisar
# de conta. Ela muda a cada reinicio - por isso o processo antigo e sempre
# derrubado e uma URL nova e sempre capturada e mostrada abaixo.
$tunnelUrl = $null
if ($dockerUp) {
    Write-Step "Abrindo tunel publico (Cloudflare) para a API"
    $cloudflaredExe = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
    if (-not (Test-Path $cloudflaredExe)) {
        $found = Get-Command cloudflared -ErrorAction SilentlyContinue
        if ($found) { $cloudflaredExe = $found.Source }
    }
    if (Test-Path $cloudflaredExe) {
        # --protocol http2 forca o cloudflared a nao depender de QUIC (UDP) -
        # diagnostico mostrou QUIC falhando especificamente nessa rede
        # (region2 do backbone da Cloudflare) enquanto HTTP/2 passava limpo.
        # Ate 3 tentativas: falha de rede transitoria na hora de pedir um
        # tunel novo (ex: "context deadline exceeded") e comum e passa numa
        # nova tentativa segundos depois.
        $tunnelLog = Join-Path $root "cloudflared-tunnel.log"
        for ($attempt = 1; $attempt -le 3 -and -not $tunnelUrl; $attempt++) {
            if ($attempt -gt 1) { Write-Warn "Tentativa $attempt de abrir o tunel..." }
            Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
            Start-Sleep -Seconds 1
            Remove-Item $tunnelLog, "$tunnelLog.err" -ErrorAction SilentlyContinue
            Start-Process -FilePath $cloudflaredExe -ArgumentList "tunnel", "--protocol", "http2", "--url", "http://localhost:3000" `
                -WindowStyle Hidden -RedirectStandardOutput $tunnelLog -RedirectStandardError "$tunnelLog.err"
            $elapsed = 0
            while ($elapsed -lt 20 -and -not $tunnelUrl) {
                Start-Sleep -Seconds 2
                $elapsed += 2
                $logText = ""
                if (Test-Path "$tunnelLog.err") { $logText = Get-Content "$tunnelLog.err" -Raw -ErrorAction SilentlyContinue }
                # api.trycloudflare.com e o endpoint INTERNO que o cloudflared usa pra
                # pedir um tunel novo - aparece no log mesmo quando a criacao FALHA
                # (ex: "failed to request quick Tunnel...api.trycloudflare.com/tunnel").
                # Excluir explicitamente evita capturar essa URL de erro como se fosse
                # o tunel de verdade (que sempre tem um subdominio gerado, nunca "api").
                if ($logText -match 'https://(?!api\.)[a-zA-Z0-9\-]+\.trycloudflare\.com') { $tunnelUrl = $Matches[0] }
            }
        }
        if ($tunnelUrl) {
            Write-Ok "Tunel publico ativo: $tunnelUrl"
            Set-Content -Path (Join-Path $root "tunnel-url.txt") -Value $tunnelUrl -NoNewline -Encoding ascii
        } else { Write-Warn "Nao capturei a URL do tunel apos 3 tentativas - confira cloudflared-tunnel.log.err" }
    } else {
        Write-Warn "cloudflared.exe nao encontrado - pulei o tunel publico (winget install cloudflare.cloudflared)."
    }
}

# ---------- 7. Resumo final ----------
$apiKey = $null
$envFile = Join-Path $root ".env"
if (Test-Path $envFile) {
    $line = Select-String -Path $envFile -Pattern '^DEFAULT_API_KEY=(.+)$' | Select-Object -First 1
    if ($line) { $apiKey = $line.Matches[0].Groups[1].Value }
}

Write-Host ""
Write-Host "########################################################" -ForegroundColor Magenta
Write-Host "#                  SISTEMA NO AR                       #" -ForegroundColor Magenta
Write-Host "########################################################" -ForegroundColor Magenta
Write-Host ""
Write-Host "  Dashboard :  http://localhost:8080  (ou http://localhost:3000/dashboard)"
Write-Host "  API       :  http://localhost:3000  (docs em /docs)"
Write-Host "  Ollama    :  http://localhost:11434"
Write-Host "  ComfyUI   :  http://localhost:8188"
if ($tunnelUrl) {
    Write-Host "  Tunel     :  $tunnelUrl" -ForegroundColor Yellow
} else {
    Write-Host "  Tunel     :  (nao disponivel nesta execucao)" -ForegroundColor DarkGray
}
Write-Host ""
if ($tunnelUrl) {
    Write-Host "  IMPORTANTE: cole essa URL no Lovable (EXTERNAL_AI_URL / Supabase secret)." -ForegroundColor Yellow
    Write-Host "  Ela muda toda vez que este script reinicia o tunel - se reiniciar o sistema," -ForegroundColor Yellow
    Write-Host "  atualize o secret no projeto Lovable com a nova URL mostrada acima." -ForegroundColor Yellow
    Write-Host ""
}
if ($apiKey) {
    Write-Host "  Sua API key (cole no projeto/Lovable):" -ForegroundColor Yellow
    Write-Host "  $apiKey" -ForegroundColor White
    Write-Host ""
    Write-Host "  Uso rapido:" -ForegroundColor Yellow
    Write-Host "  curl -X POST http://localhost:3000/v1/text -H `"x-api-key: $apiKey`" -H `"content-type: application/json`" -d `"{\`"prompt\`":\`"ola\`"}`""
} else {
    Write-Warn "Nao encontrei DEFAULT_API_KEY no .env - gere uma pelo dashboard em API Keys."
}
Write-Host ""
Write-Host "  Para parar tudo: scripts\parar-sistema.ps1 (ou PARAR.bat na raiz)"
Write-Host ""

if (-not $Silent) { try { Start-Process "http://localhost:8080" } catch { } }
