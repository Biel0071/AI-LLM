# 📋 TAREFAS PRIORITÁRIAS — API PLATFORM ENTERPRISE

**Objetivo:** Levar sistema de RC-1 para RC-3 (Produção Full)  
**Prazo Estimado:** 3-5 dias  
**Responsável:** Tech Lead / Release Manager

---

## FASE 1 — PRODUÇÃO IMEDIATA (1-2 dias)

### T1 — Integrar RequestLog → calculateScore

**Prioridade:** P1 (ALTO)  
**Tempo Estimado:** 4h  
**Arquivos:** `packages/shared/src/providers/registry.ts`

#### Problema Atual
O método `calculateScore()` usa apenas `fallbackMetrics` hardcoded, ignorando dados reais do RequestLog. Isso faz com que:
- Providers novos recebam scores fictícios
- Dashboard mostre latência/custo irreais
- Decisão de roteamento seja baseada em dados incorretos

#### Critérios de Aceite
- [ ] `calculateScore()` consulta últimas 100 chamadas do provider no RequestLog
- [ ] Calcula média real de latência, tokens, custo
- [ ] Mantém fallback apenas para providers com <5 chamadas históricas
- [ ] Score é recalculado dinamicamente a cada nova chamada
- [ ] Testes unitários cobrem cenários com/sem histórico

#### Implementação

```typescript
// Adicionar ao registry.ts:

interface RealMetrics {
  health: number;
  latency: number;
  cost: number;
  throughput: number;
  callCount: number;
}

async function fetchRealMetrics(
  providerName: string, 
  prisma: PrismaClient
): Promise<RealMetrics | null> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // últimas 24h
  
  const logs = await prisma.requestLog.findMany({
    where: {
      provider: providerName,
      createdAt: { gte: since }
    },
    orderBy: { createdAt: 'desc' },
    take: 100
  });
  
  if (logs.length < 5) return null; // mínimo estatístico
  
  const totalCalls = logs.length;
  const successCalls = logs.filter(l => l.success).length;
  const avgLatency = logs.reduce((sum, l) => sum + l.durationMs, 0) / totalCalls;
  const totalCost = logs.reduce((sum, l) => sum + l.cost, 0);
  const totalTokens = logs.reduce((sum, l) => sum + l.totalTokens, 0);
  
  return {
    health: successCalls / totalCalls,
    latency: avgLatency,
    cost: totalCost / (totalTokens / 1000), // custo por 1k tokens
    throughput: totalTokens / logs.reduce((sum, l) => sum + l.durationMs, 0) * 1000,
    callCount: totalCalls
  };
}

// Modificar calculateScore para aceitar PrismaClient opcional
public async calculateScore(
  provider: AIProvider, 
  capability: Capability,
  prisma?: PrismaClient
): Promise<number> {
  let metrics: ProviderMetrics;
  
  // Tentar obter métricas reais primeiro
  if (prisma) {
    const realMetrics = await fetchRealMetrics(provider.name, prisma);
    if (realMetrics && realMetrics.callCount >= 5) {
      metrics = {
        priority: fallbackMetrics[provider.name]?.priority || 3,
        health: realMetrics.health,
        latency: realMetrics.latency,
        contextWindow: fallbackMetrics[provider.name]?.contextWindow || 4096,
        cost: realMetrics.cost,
        throughput: realMetrics.throughput
      };
    } else {
      // Fallback para providers sem histórico suficiente
      metrics = fallbackMetrics[provider.name] || {
        priority: 3, health: 1.0, latency: 1000,
        contextWindow: 4096, cost: 5, throughput: 10
      };
    }
  } else {
    // Sem Prisma, usa fallback
    metrics = fallbackMetrics[provider.name] || {
      priority: 3, health: 1.0, latency: 1000,
      contextWindow: 4096, cost: 5, throughput: 10
    };
  }
  
  // ... resto do cálculo atual ...
}
```

#### Dependências
- PrismaClient disponível no contexto da API
- RequestLog populado (já existe)

---

### T2 — Criar testes para calculateScore

**Prioridade:** P2 (MÉDIO)  
**Tempo Estimado:** 2-3h  
**Arquivos:** `packages/shared/src/providers/registry.test.ts` (NOVO)

#### Critérios de Aceite
- [ ] Cobertura >80% do método calculateScore
- [ ] Teste com provider sem histórico (usa fallback)
- [ ] Teste com provider com histórico (usa dados reais)
- [ ] Teste de saúde baixa (<0.5) retorna score negativo
- [ ] Teste de prioridade (local > cloud > fallback)

#### Estrutura do Teste

```typescript
// packages/shared/src/providers/registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderRegistry } from './registry';
import { OllamaProvider } from './ollama.provider';

describe('ProviderRegistry.calculateScore', () => {
  let registry: ProviderRegistry;
  
  beforeEach(() => {
    registry = new ProviderRegistry();
    registry.register(new OllamaProvider({ baseUrl: 'http://localhost:11434' }));
  });
  
  it('deve usar fallback para provider sem histórico', () => {
    const provider = registry.get('ollama');
    const score = registry.calculateScore(provider, 'chat');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(15000);
  });
  
  it('deve penalizar severamente provider com health < 0.5', () => {
    // Mock de provider com health baixa
    // ... implementar
  });
  
  it('deve priorizar providers locais (priority 1)', () => {
    // Comparar scores de ollama vs openai
    // ... implementar
  });
});
```

---

### T3 — Automatizar renovação TLS

**Prioridade:** P1 (CRÍTICO)  
**Tempo Estimado:** 1-2h  
**Arquivos:** `/opt/api-platform-tls/renew-cert.sh`, crontab

#### Problema Atual
Certificado Let's Encrypt expira em 2026-10-27. Renovação foi feita manualmente uma vez. Se esquecer, sistema fica offline.

#### Critérios de Aceite
- [ ] Script `renew-cert.sh` roda certbot automaticamente
- [ ] Cron executa diariamente às 3am
- [ ] Hook reload Caddy após renovação bem-sucedida
- [ ] Log de renovação em `/var/log/api-platform-tls.log`
- [ ] Alerta se renovação falhar

#### Implementação

```bash
#!/bin/bash
# /opt/api-platform-tls/renew-cert.sh

set -e

DOMAIN="sua-api.com"
EMAIL="admin@sua-api.com"
LOG_FILE="/var/log/api-platform-tls.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "Iniciando renovação do certificado para $DOMAIN"

# Tentar renew (certbot só renova se <30 dias do expiry)
if certbot renew --quiet --agree-tos --email "$EMAIL" -d "$DOMAIN"; then
  log "Renovação bem-sucedida ou não necessária"
  
  # Reload Caddy para aplicar novo cert
  if systemctl is-active --quiet caddy; then
    systemctl reload caddy
    log "Caddy recarregado com novo certificado"
  fi
else
  log "ERRO: Falha na renovação do certificado"
  # Aqui poderia enviar alerta (email, slack, etc)
  exit 1
fi
```

```bash
# Adicionar ao crontab (crontab -e)
0 3 * * * /opt/api-platform-tls/renew-cert.sh
```

#### Validação
```bash
# Testar script manualmente
sudo /opt/api-platform-tls/renew-cert.sh

# Verificar cron
grep api-platform-tls /etc/crontab

# Simular renew dry-run
certbot renew --dry-run
```

---

## FASE 2 — VALIDAÇÃO RUNTIME (2-3 dias)

### T4 — Smoke tests automatizados

**Prioridade:** P2 (ALTO)  
**Tempo Estimado:** 3h  
**Arquivos:** `scripts/smoke-tests.sh` (NOVO)

#### Critérios de Aceite
- [ ] Testa todos os endpoints críticos
- [ ] Valida response codes (200, 201, 401, etc.)
- [ ] Testa login dashboard
- [ ] Testa criação de projeto
- [ ] Testa geração de API key
- [ ] Testa chamada provider
- [ ] Reporta status PASS/FAIL por teste
- [ ] Exit code 1 se algum teste falhar

#### Estrutura do Script

```bash
#!/bin/bash
# scripts/smoke-tests.sh

set -e

API_URL="${API_URL:-http://localhost:3000}"
DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:3000/dashboard}"
TOKEN=""

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

pass() { echo -e "${GREEN}✓ PASS${NC}: $1"; }
fail() { echo -e "${RED}✗ FAIL${NC}: $1"; exit 1; }

echo "🚀 API Platform Smoke Tests"
echo "==========================="
echo "API URL: $API_URL"
echo ""

# Test 1: Health endpoint
echo "Test 1: Health Check..."
RESPONSE=$(curl -s -w "\n%{http_code}" "$API_URL/v1/health")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
  pass "Health endpoint returns 200"
else
  fail "Health endpoint returned $HTTP_CODE"
fi

# Test 2: Admin login
echo "Test 2: Admin Login..."
RESPONSE=$(curl -s -X POST "$API_URL/admin/login" \
  -H "Content-Type: application/json" \
  -d '{"login":"admin","password":"admin"}')
TOKEN=$(echo "$RESPONSE" | jq -r '.token // empty')

if [ -n "$TOKEN" ]; then
  pass "Login successful, token obtained"
else
  fail "Login failed: $RESPONSE"
fi

# Test 3: Overview (requires auth)
echo "Test 3: Admin Overview..."
RESPONSE=$(curl -s -w "\n%{http_code}" "$API_URL/admin/overview" \
  -H "Authorization: Bearer $TOKEN")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "200" ]; then
  pass "Overview endpoint accessible with auth"
else
  fail "Overview returned $HTTP_CODE"
fi

# Test 4: Providers list
echo "Test 4: Providers List..."
RESPONSE=$(curl -s "$API_URL/admin/providers" \
  -H "Authorization: Bearer $TOKEN")
PROVIDER_COUNT=$(echo "$RESPONSE" | jq '.providers | length')

if [ "$PROVIDER_COUNT" -gt 0 ]; then
  pass "Providers list contains $PROVIDER_COUNT providers"
else
  fail "No providers found"
fi

# Test 5: Projects CRUD
echo "Test 5: Create Project..."
PROJECT_NAME="smoke-test-$(date +%s)"
RESPONSE=$(curl -s -X POST "$API_URL/admin/projects" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$PROJECT_NAME\",\"tenantId\":\"default\"}")
PROJECT_ID=$(echo "$RESPONSE" | jq -r '.id // empty')

if [ -n "$PROJECT_ID" ]; then
  pass "Project created: $PROJECT_ID"
  
  # Cleanup
  curl -s -X DELETE "$API_URL/admin/projects/$PROJECT_ID" \
    -H "Authorization: Bearer $TOKEN" > /dev/null
  pass "Project cleaned up"
else
  fail "Failed to create project: $RESPONSE"
fi

echo ""
echo "==========================="
echo "✅ All smoke tests passed!"
```

---

### T5 — Fluxo SaaS end-to-end

**Prioridade:** P2 (ALTO)  
**Tempo Estimado:** 4h  
**Arquivos:** Dashboard + Validação manual/script

#### Critérios de Aceite
- [ ] Novo tenant criado via dashboard
- [ ] Projeto associado ao tenant
- [ ] Runtime gerado automaticamente
- [ ] API Key gerada e exibida
- [ ] Provider configurado com credenciais
- [ ] Playground executa chamada real
- [ ] Resposta aparece no Playground
- [ ] Log registrado em RequestLog
- [ ] Health mostra projeto ONLINE

#### Roteiro de Validação

```
1. Dashboard → Tenants → Novo Tenant
   Nome: "Cliente Teste"
   Slug: "cliente-teste"
   ✓ Salvar

2. Dashboard → Projects → Novo Projeto
   Nome: "Projeto Demo"
   Tenant: "Cliente Teste"
   Domínio: "demo.lovable.app"
   ✓ Criar
   ✓ Anotar ProjectID

3. Dashboard → API Keys → Nova Chave
   Nome: "chave-producao"
   Projeto: "Projeto Demo"
   ✓ Gerar
   ✓ Copiar API Key (ap_...)

4. Dashboard → Providers → Configurar Ollama
   Provider: ollama
   Endpoint: http://localhost:11434
   Modelo: llama-3.1-8b-instruct
   ✓ Salvar e Ativar
   ✓ Testar → "Online (XXXms)"

5. Dashboard → Playground
   Provider: ollama
   Modelo: llama-3.1-8b-instruct
   Prompt: "Diga olá"
   ✓ Executar
   ✓ Verificar resposta

6. Dashboard → Logs
   ✓ Verificar log da chamada acima
   ✓ Confirmar provider, modelo, tokens, custo

7. Dashboard → Overview
   ✓ Verificar projeto listado como ONLINE
   ✓ Verificar métricas atualizadas
```

---

## FASE 3 — PERFORMANCE (2 dias)

### T6 — Stress tests

**Prioridade:** P3 (MÉDIO)  
**Tempo Estimado:** 4h  
**Arquivos:** `scripts/stress-test.sh` (NOVO), k6 ou autocannon

#### Critérios de Aceite
- [ ] Script executa 100, 500, 1000, 5000 requisições
- [ ] Mede latência p50, p95, p99
- [ ] Mede taxa de erro (%)
- [ ] Monitora RAM, CPU, Redis, Queue
- [ ] Identifica gargalos
- [ ] Gera relatório comparativo

#### Exemplo com autocannon

```bash
#!/bin/bash
# scripts/stress-test.sh

API_URL="${API_URL:-http://localhost:3000}"
TOKEN="${API_TOKEN:-}" # Obter via login antes

if [ -z "$TOKEN" ]; then
  echo "Obtendo token..."
  TOKEN=$(curl -s -X POST "$API_URL/admin/login" \
    -H "Content-Type: application/json" \
    -d '{"login":"admin","password":"admin"}' | jq -r '.token')
fi

echo "🚀 Stress Test - API Platform"
echo "=============================="
echo "URL: $API_URL"
echo "Token: ${TOKEN:0:20}..."
echo ""

for RPS in 10 50 100 200; do
  echo "Testando $RPS req/s por 30s..."
  
  autocannon -c 20 -r $RPS -d 30 \
    -H "Authorization: Bearer $TOKEN" \
    "$API_URL/v1/chat/completions" \
    -m POST \
    -H "Content-Type: application/json" \
    -b '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}]}'
  
  echo ""
  echo "---"
  echo ""
done
```

#### Métricas para Coletar

| Carga | p50 | p95 | p99 | Erros | RAM | CPU |
|-------|-----|-----|-----|-------|-----|-----|
| 100 req/s | | | | | | |
| 500 req/s | | | | | | |
| 1000 req/s | | | | | | |
| 5000 req/s | | | | | | |

---

## 📊 ACOMPANHAMENTO

### Status das Tarefas

| ID | Tarefa | Status | Iniciado Em | Concluído Em | Bloqueadores |
|----|--------|--------|-------------|--------------|--------------|
| T1 | RequestLog → Score | ⏳ Pendente | | | |
| T2 | Testes calculateScore | ⏳ Pendente | | | Depende T1 |
| T3 | Auto-renew TLS | ⏳ Pendente | | | |
| T4 | Smoke tests | ⏳ Pendente | | | |
| T5 | Fluxo SaaS | ⏳ Pendente | | | Depende T4 |
| T6 | Stress tests | ⏳ Pendente | | | Depende T4 |

### Definição de Pronto (DoD)

Uma tarefa só é considerada **CONCLUÍDA** quando:
- ✅ Código implementado
- ✅ Testes passando
- ✅ Documentação atualizada (se aplicável)
- ✅ Validado em ambiente de staging
- ✅ Merge na branch main

---

## 🎯 ROADMAP PARA RC-3

```
Semana 1:
├─ Fase 1: Produção Imediata (T1, T2, T3)
│  ├─ T1: RequestLog → Score ✅
│  ├─ T2: Testes calculateScore ✅
│  └─ T3: Auto-renew TLS ✅
│
├─ Fase 2: Validação Runtime (T4, T5)
│  ├─ T4: Smoke tests ✅
│  └─ T5: Fluxo SaaS ✅
│
└─ Fase 3: Performance (T6)
   └─ T6: Stress tests ✅

RC-3 Ready → Produção Full
```

---

**Última atualização:** 2026-01-xx  
**Próxima revisão:** Após conclusão da Fase 1
