# Deploy

## Local → VPS sem alterar código

Todo o comportamento é controlado por variáveis de ambiente (`.env`). O mesmo build
roda localmente e em produção.

## VPS (Ubuntu/Debian)

```bash
git clone <seu-repo> ai-platform && cd ai-platform
bash scripts/deploy-vps.sh
```

O script instala Docker (se necessário), gera `JWT_SECRET`, `ADMIN_PASSWORD` e
`DEFAULT_API_KEY` fortes, e sobe a stack completa.

### Portas

| Serviço | Porta |
|---|---|
| API (Fastify) | 3000 |
| Dashboard (nginx) | 8080 |
| Postgres | 5432 |
| Redis | 6379 |
| Prometheus (opcional) | 9090 |
| Grafana (opcional) | 3001 |

## TLS com Traefik (recomendado em produção)

Crie `docker-compose.traefik.yml`:

```yaml
services:
  traefik:
    image: traefik:v3.1
    restart: unless-stopped
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
      - --certificatesresolvers.le.acme.tlschallenge=true
      - --certificatesresolvers.le.acme.email=voce@dominio.com
      - --certificatesresolvers.le.acme.storage=/letsencrypt/acme.json
    ports: ['80:80', '443:443']
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - letsencrypt:/letsencrypt

  api:
    labels:
      - traefik.enable=true
      - traefik.http.routers.api.rule=Host(`ai.seudominio.com`)
      - traefik.http.routers.api.entrypoints=websecure
      - traefik.http.routers.api.tls.certresolver=le
      - traefik.http.services.api.loadbalancer.server.port=3000

volumes:
  letsencrypt:
```

```bash
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d
```

Alternativa simples: use o `docker/nginx.conf` como base atrás de um certbot.

## Monitoramento

```bash
docker compose --profile monitoring up -d
```

- Prometheus: `http://IP:9090` — scrape de `/metrics` da API
- Grafana: `http://IP:3001` (admin/admin) — adicione o Prometheus como datasource
  (`http://prometheus:9090`) e monte dashboards com `ai_requests_total`,
  `ai_request_duration_seconds`, `ai_tokens_total`

## Escalando workers

```bash
docker compose up -d --scale worker=4
```

Ajuste `WORKER_CONCURRENCY` para controlar jobs simultâneos por worker.

## Backup

- Postgres: volume `pgdata` (use `pg_dump` agendado)
- Redis: volume `redisdata` (appendonly ativado)

## Checklist de produção

- [ ] `NODE_ENV=production`
- [ ] `JWT_SECRET` forte e único
- [ ] `ADMIN_PASSWORD` forte (o script de VPS já gera)
- [ ] TLS habilitado (Traefik/Caddy/nginx)
- [ ] Portas 5432/6379 fechadas no firewall (apenas rede interna do Docker)
- [ ] Backup do Postgres agendado
- [ ] Chaves de providers pagos com limite de gasto configurado no fornecedor
