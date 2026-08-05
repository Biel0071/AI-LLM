# ====================================================
# baixar-modelos-ollama.ps1
# Baixa todos os modelos open source no Ollama:
#   - Qwen 2.5:7b  (flagship - melhor chat/texto)
#   - Gemma 3:4b   (rapido - classificacao/SEO/traducao)
#   - GLM4:9b      (ChatGLM / "Kimi" open source)
#   - Moondream    (vision / OCR compacto)
#   - nomic-embed  (embeddings / RAG)
#
# Uso:
#   .\baixar-modelos-ollama.ps1                            # Ollama local (localhost:11434)
#   .\baixar-modelos-ollama.ps1 -OllamaHost "IP" -OllamaPort 11434  # VPS remota
# ====================================================
param(
    [string]$OllamaHost = "localhost",
    [int]$OllamaPort    = 11434
)

$baseUrl = "http://${OllamaHost}:${OllamaPort}"
$ProgressPreference = 'SilentlyContinue'

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK  - $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    !!  - $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "    XX  - $msg" -ForegroundColor Red }

Write-Step "Verificando Ollama em $baseUrl"
try {
    $check = Invoke-RestMethod -Uri "$baseUrl/api/tags" -Method Get -TimeoutSec 5 -ErrorAction Stop
    $nomes = ($check.models | ForEach-Object { $_.name }) -join ', '
    if ($nomes) { Write-Ok "Ollama online. Instalados: $nomes" } else { Write-Ok "Ollama online. Nenhum modelo ainda." }
} catch {
    Write-Err "Ollama nao respondeu em $baseUrl"
    Write-Host "  -> Local : INICIAR.bat ou scripts\iniciar-sistema.ps1" -ForegroundColor Yellow
    Write-Host "     VPS   : docker compose --profile vps up -d" -ForegroundColor Yellow
    exit 1
}

$models = @(
    @{ name = "qwen2.5:7b";        desc = "Qwen 2.5 7B    -- flagship chat/texto (Alibaba)" },
    @{ name = "gemma3:4b";         desc = "Gemma 3 4B     -- rapido, classificacao/SEO (Google)" },
    @{ name = "glm4:9b";           desc = "GLM4 9B        -- ChatGLM / Kimi open source (Zhipu AI)" },
    @{ name = "moondream";         desc = "Moondream      -- vision/OCR compacto" },
    @{ name = "nomic-embed-text";  desc = "nomic-embed    -- embeddings/RAG/busca semantica" }
)

Write-Host ""
Write-Host "  Modelos que serao baixados:" -ForegroundColor White
foreach ($m in $models) { Write-Host "    * $($m.desc)" -ForegroundColor DarkCyan }
Write-Host ""

$total = $models.Count; $idx = 0
foreach ($m in $models) {
    $idx++
    Write-Step "[$idx/$total] Baixando: $($m.name)"
    Write-Host "    $($m.desc)" -ForegroundColor DarkGray

    try {
        $tags = Invoke-RestMethod -Uri "$baseUrl/api/tags" -Method Get -TimeoutSec 5 -ErrorAction Stop
        $inst = $tags.models | Where-Object { $_.name -eq $m.name }
        if ($inst) { Write-Ok "Ja instalado -- pulando"; continue }
    } catch {}

    try {
        $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes((@{ name = $m.name } | ConvertTo-Json -Compress))
        $uri = [System.Uri]"$baseUrl/api/pull"
        $req = [System.Net.WebRequest]::Create($uri)
        $req.Method = "POST"; $req.ContentType = "application/json"; $req.Timeout = 3600000
        $req.ContentLength = $bodyBytes.Length
        $s = $req.GetRequestStream(); $s.Write($bodyBytes,0,$bodyBytes.Length); $s.Close()
        $resp = $req.GetResponse()
        $reader = [System.IO.StreamReader]::new($resp.GetResponseStream())
        $lastStatus = ""; $lastPct = -1
        while (-not $reader.EndOfStream) {
            $line = $reader.ReadLine()
            if (-not $line) { continue }
            try {
                $j = $line | ConvertFrom-Json
                if ($j.total -and $j.completed) {
                    $pct = [int](($j.completed / $j.total) * 100)
                    if ($pct -ne $lastPct) {
                        Write-Host "    ... $($j.status) $pct% ($([math]::Round($j.completed/1MB,1)) MB / $([math]::Round($j.total/1MB,1)) MB)" -ForegroundColor DarkGray
                        $lastPct = $pct
                    }
                } elseif ($j.status -and $j.status -ne $lastStatus) {
                    Write-Host "    ... $($j.status)" -ForegroundColor DarkGray
                    $lastStatus = $j.status
                }
            } catch {}
        }
        $reader.Close(); $resp.Close()
        Write-Ok "$($m.name) pronto!"
    } catch {
        Write-Err "Falha ao baixar $($m.name): $_"
        Write-Warn "Tente manualmente: ollama pull $($m.name)"
    }
}

Write-Host ""
Write-Host "########################################################" -ForegroundColor Magenta
Write-Host "#        MODELOS INSTALADOS -- RESUMO FINAL            #" -ForegroundColor Magenta
Write-Host "########################################################" -ForegroundColor Magenta
try {
    $final = Invoke-RestMethod -Uri "$baseUrl/api/tags" -Method Get -TimeoutSec 5
    foreach ($m in $final.models) {
        $sizeGB = [math]::Round($m.size / 1GB, 2)
        Write-Host "  [OK] $($m.name.PadRight(30)) $sizeGB GB" -ForegroundColor Green
    }
} catch { Write-Warn "Nao foi possivel listar modelos instalados" }

Write-Host ""
Write-Host "  Pronto! Use no header das requisicoes:" -ForegroundColor Yellow
Write-Host "  x-api-key: <valor de DEFAULT_API_KEY no .env>" -ForegroundColor White
Write-Host ""
