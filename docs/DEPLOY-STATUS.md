# Status de Deploy — AI Platform (produção)

## Gateway na VPS-B (.215) — TLS ativo

O gateway ai-platform roda na VPS-B (`209.50.241.215`, 16GB, AlmaLinux, tier `power`).
O acesso de outros projetos (FÊNIX na `.22`) agora é **HTTPS com certificado válido**,
não mais HTTP em claro.

### Endereço para o FÊNIX

```
GRG_AIPLATFORM_URL=https://209-50-241-215.sslip.io:8443
GRG_AIPLATFORM_KEY=<API key ap_... do gateway>
```

- **NÃO** use mais `http://209.50.241.215:3000` — a porta 3000 agora escuta só em
  `127.0.0.1` (loopback), inacessível pela rede. A chave viajava em claro por ali.
- O endereço HTTPS usa o cert Let's Encrypt de `209-50-241-215.sslip.io` (válido,
  não self-signed — o cliente do FÊNIX aceita sem `-k`).

### Como o caminho TLS funciona

```
FÊNIX (.22) --HTTPS--> Caddy :8443 (TLS, cert LE) --http--> 127.0.0.1:3000 (gateway)
```

- **Caddy** (container `ai-platform-caddy`, host network) termina o TLS na porta 8443,
  proxia para o gateway em loopback. Config em `/opt/ai-platform-tls/Caddyfile`.
- **Isolamento em duas camadas:** o Caddyfile só aceita `remote_ip 209.50.241.22`
  (403 para o resto), e o firewalld só libera a 8443 para a origem `.22` (o resto cai
  pela política default-deny da zona `public`).
- Cert em `/etc/letsencrypt/live/209-50-241-215.sslip.io/`, emitido via webroot do
  painel ICP (que já serve `/.well-known/acme-challenge`). Expira 2026-10-27.

### Provas medidas (2026-07-29)

| Teste | Resultado |
|---|---|
| HTTPS da `.22` (cert válido, sem `-k`) | **200** — geração real, warm ~0.9s, cache hit 0.07s |
| HTTPS do PC externo (não-`.22`) | **000** — barrado pelo firewalld antes do Caddy |
| HTTP `:3000` cru de qualquer lugar | **000** — só loopback |

### Pendências operacionais (renovação/persistência)

- **Renovação do cert:** o certbot foi rodado via container uma vez. A renovação
  automática ainda **não** está agendada — antes de 2026-10-27, configurar um cron/timer
  que rode `certbot renew` (container) e recarregue o Caddy (`docker exec ai-platform-caddy
  caddy reload` ou restart).
- **Boot:** o Caddy sobe com `--restart unless-stopped`. Confirmar que ele reaplica após
  reboot da VPS (não testado neste ciclo).
