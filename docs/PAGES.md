# Pages & Components Inventory - API Platform Enterprise v5.0

Toda interface está isolada no diretório `apps/dashboard/public`. A SPA não usa bundlers, sendo gerenciada nativamente por `index.html` e `app.js`.

## Layout Base (`index.html`)
- `<div id="login">`
- `<div id="shell">` (Main App Container)
  - `<aside class="sidebar">`
  - `<main id="content">`

## Pages (`app.js`)
As funções renderizadoras em `const pages = { ... }`:
1. `home()`: Status geral e métricas.
2. `providers()`: Gerenciamento de credenciais LLM.
3. `settings()`: Criação de Tenants.
4. `fenix()` / `runtime()`: Dados de proxy ICP.
5. `icp()`: Status do proxy estático.
6. `mission()`: Interface visual de missões (Radar).

## UI Components (`app.js`)
- `table(headers, rows)`: Helper que gera `<table/>` responsivas.
- `badge(ok, textOk, textErr)`: Gera tags visuais de status.
- `fmtDate(d)`: Formatador de datas UTC.
- `fmtMs(ms)`: Formatador de latência.
- `card(label, value, cls, id)`: Box de métrica central.

## Regra RC v5.0
**Proibido** adicionar componentes visuais extras via bibliotecas externas. Todo novo modal ou input seguirá o padrão existente em `app.css`.
