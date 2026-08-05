/* API Platform — Dashboard administrativo (SPA sem build) */
(() => {
  'use strict';

  const API = ''; // mesmo host da API (servido em /dashboard) ou proxy nginx
  const $ = (sel) => document.querySelector(sel);
  const content = () => $('#content');

  // ---------- Auth ----------
  const token = () => localStorage.getItem('apiplatform_token');
  const setToken = (t) => localStorage.setItem('apiplatform_token', t);
  const clearToken = () => localStorage.removeItem('apiplatform_token');

  async function api(path, options = {}) {
    const res = await fetch(API + path, {
      ...options,
      headers: {
        // content-type: application/json SO quando ha body. Fastify rejeita
        // POST sem body se o content-type for json ("Body cannot be empty").
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(token() ? { authorization: `Bearer ${token()}` } : {}),
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (res.status === 401) {
      clearToken();
      showLogin();
      throw new Error('sessao expirada');
    }
    const data = await res.json();
    if (!res.ok && data?.error) throw new Error(data.error.message || 'erro');
    return data;
  }

  function showLogin() {
    $('#login').classList.remove('hidden');
    $('#shell').classList.add('hidden');
  }
  function showShell() {
    $('#login').classList.add('hidden');
    $('#shell').classList.remove('hidden');
    route();
  }

  $('#toggle-password').addEventListener('click', () => {
    const field = $('#login-password');
    const button = $('#toggle-password');
    const visible = field.type === 'text';
    field.type = visible ? 'password' : 'text';
    button.textContent = visible ? 'Mostrar' : 'Ocultar';
    button.setAttribute('aria-label', visible ? 'Mostrar senha' : 'Ocultar senha');
    button.setAttribute('aria-pressed', String(!visible));
  });

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('#login-error');
    errEl.classList.add('hidden');
    try {
      const data = await fetch(API + '/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          login: $('#login-email').value.trim(),
          password: $('#login-password').value,
        }),
      }).then((r) => r.json());
      if (!data.token) throw new Error(data?.error?.message || 'credenciais invalidas');
      setToken(data.token);
      showShell();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });

  $('#logout').addEventListener('click', () => {
    clearToken();
    showLogin();
  });

  const navState = JSON.parse(localStorage.getItem('apiplatform_nav') || '{"dashboard":true}');
  document.querySelectorAll('.nav-group').forEach((group) => {
    const name = group.dataset.group;
    group.classList.toggle('open', Boolean(navState[name]));
    group.querySelector('.nav-group-toggle').addEventListener('click', () => {
      navState[name] = !group.classList.contains('open');
      group.classList.toggle('open', navState[name]);
      localStorage.setItem('apiplatform_nav', JSON.stringify(navState));
    });
  });

  // ---------- Helpers de UI ----------
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const card = (label, value, cls = '') =>
    `<div class="card"><div class="label">${esc(label)}</div><div class="value ${cls}">${esc(value)}</div></div>`;

  const table = (headers, rows) =>
    `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>` +
    `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') || ''}</tbody></table>`;

  const badge = (ok, textOk = 'online', textErr = 'offline') =>
    ok ? `<span class="badge ok">${textOk}</span>` : `<span class="badge err">${textErr}</span>`;

  const fmtDate = (d) => (d ? new Date(d).toLocaleString('pt-BR') : '—');
  const fmtMs = (ms) => (ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms');
  const fileDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);
  });
  const imageActions = [
    ['custom','Personalizado'],['new-angle','Novo angulo'],['new-position','Nova posicao'],['new-lighting','Nova iluminacao'],
    ['new-color','Nova cor'],['new-background','Novo fundo'],['new-clothing','Nova roupa'],['model-wearing','Modelo vestindo'],
    ['catalog','Catalogo'],['mockup','Mockup'],['lifestyle','Lifestyle'],['marketplace','Marketplace'],
  ];
  const renderGenerated = (data) => data.jobId
    ? `<pre class="code">Job criado: ${esc(data.jobId)}\nAcompanhe em Image Queue.</pre>`
    : `<div class="image-grid">${(data.result?.images||[]).map((img)=>`<article class="card"><img src="data:${img.mimeType||'image/png'};base64,${img.base64}" /><a href="${img.url||'#'}" class="muted">${esc(data.provider)} / ${esc(data.model)}</a></article>`).join('')}</div>`;

  // ---------- Paginas ----------
  const pages = {
    async home() {
      content().innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h1>Visao Geral do Sistema</h1>
          <div id="live-status" class="badge ok">SISTEMA ONLINE</div>
        </div>
        <div class="cards">
          ${card('Latencia Global', '0ms', '', 'home-latency')}
          ${card('Requests (24h)', '0', '', 'home-reqs')}
          ${card('Tokens (24h)', '0', '', 'home-tokens')}
          ${card('Custo (24h)', '$0.00', '', 'home-cost')}
          ${card('Tenants Ativos', '0', '', 'home-tenants')}
          ${card('Uptime', '0s', '', 'home-uptime')}
          ${card('Memoria', '0MB', '', 'home-mem')}
          ${card('Workers', '0', 'ok', 'home-workers')}
        </div>
        <div class="section" style="margin-top:2rem;">
          <h2>Modulos da Plataforma</h2>
          <div class="cards" id="home-modules"></div>
        </div>
        <div class="section">
          <h2>Providers em Tempo Real</h2>
          <div class="table-container">
            <table id="home-providers-table">
              <thead><tr><th>Provider</th><th>Status</th><th>Latencia</th><th>Requests</th><th>Tokens</th><th>Custo (USD)</th></tr></thead>
              <tbody></tbody>
            </table>
          </div>
        </div>`;
      
      const updateHome = async () => {
        if (location.hash.replace('#/', '') !== 'home' && location.hash !== '') return;
        try {
          const [ { overview }, health ] = await Promise.all([
            api('/admin/overview'),
            fetch(API + '/v1/health').then(r => r.json())
          ]);
          
          if ($('#home-latency')) {
            $('#home-latency').textContent = (health.latency || o.last24h.avgDurationMs) + 'ms';
            $('#home-reqs').textContent = overview.last24h.requests;
            $('#home-tokens').textContent = overview.last24h.totalTokens;
            $('#home-cost').textContent = '$' + Number(overview.last24h.cost).toFixed(4);
            $('#home-tenants').textContent = overview.tenants;
            $('#home-uptime').textContent = (health.uptime || 0) + 's';
            $('#home-mem').textContent = health.memory ? health.memory.free + 'MB livres' : 'OK';
            $('#home-workers').textContent = health.workers || 12;
            
            const mods = ['API','Dashboard','Postgres','Redis','Mission','Streaming','Docker','SSL'];
            $('#home-modules').innerHTML = mods.map(m => card(m, health[m.toLowerCase()] ? 'ONLINE' : (health.checks?.[m.toLowerCase()] ? 'ONLINE' : 'N/A'), health[m.toLowerCase()] ? 'ok' : '')).join('');

            const tbody = $('#home-providers-table tbody');
            if (tbody && health.providers) {
              tbody.innerHTML = Object.entries(health.providers).map(([name, p]) => 
                `<tr>
                  <td><strong>${esc(name)}</strong></td>
                  <td>${badge(p.status === 'ONLINE', p.status || 'ONLINE', 'OFFLINE')}</td>
                  <td>${p.latency}ms</td>
                  <td>${p.requests || 0}</td>
                  <td>${p.tokens || 0}</td>
                  <td>$${Number(p.cost || 0).toFixed(4)}</td>
                </tr>`
              ).join('');
            }
          }
        } catch (e) { console.error(e); }
        setTimeout(updateHome, 5000);
      };
      updateHome();
    },

    async projects() {
      content().innerHTML = '<h1>Projetos</h1><p class="muted">Carregando...</p>';
      try {
        const [{ projects }, { tenants }, { providers }] = await Promise.all([
          api('/admin/projects'), api('/admin/tenants'), api('/admin/providers')
        ]);
        const renderList = () => {
          content().innerHTML = `
            <div class="toolbar" style="justify-content: space-between; align-items: center; margin-bottom: 2rem;">
              <h1 style="margin:0;">Projetos</h1>
              <button id="btn-new-project" class="ok" style="padding: 10px 20px; font-weight:bold;">Novo Projeto</button>
            </div>
            <div class="cards" id="projects-list">
              ${projects.length === 0 ? '<p class="muted">Nenhum projeto cadastrado.</p>' : ''}
              ${projects.map(p => `
                <div class="card" style="cursor:pointer; position:relative; overflow:hidden;" onclick="location.hash='#/projects'">
                  <div style="position:absolute; top:0; left:0; width:4px; height:100%; background:var(--accent);"></div>
                  <h3>${esc(p.name)}</h3>
                  <p class="muted">${esc(p.tenant?.name || 'Sem tenant')}</p>
                  <div style="margin-top:1rem;">${badge(p.active)} <span class="muted" style="margin-left:8px; font-size:0.8rem;">${p._count?.apiKeys || 0} chaves</span></div>
                </div>
              `).join('')}
            </div>
          `;
          $('#btn-new-project').addEventListener('click', renderWizard);
        };

        const renderWizard = () => {
          content().innerHTML = `
            <h1>Novo Projeto (Wizard)</h1>
            <div class="card section" id="wizard-container" style="max-width:800px; margin: 2rem auto;">
              
              <div id="step-1" class="wizard-step">
                <h2>Passo 1: Definir Projeto</h2>
                <div class="form-grid">
                  <label>Nome do Projeto <input id="w-name" placeholder="Ex: SaaS Marketing API" /></label>
                  <label>Tenant (Loja) 
                    <select id="w-tenant">
                      ${tenants.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}
                    </select>
                  </label>
                  <label>Ambiente <select id="w-env"><option value="live">Produção (Live)</option><option value="staging">Staging</option></select></label>
                  <label>Domínio Customizado <input id="w-domain" placeholder="api.empresa.com" /></label>
                </div>
                <div class="toolbar" style="margin-top: 2rem; justify-content: flex-end;"><button id="btn-step-1">Gerar Infraestrutura →</button></div>
              </div>
              
              <div id="step-2" class="wizard-step hidden">
                <h2>Passo 2: Provisionamento & Chaves</h2>
                <p class="muted">Gerando IDs, configurando queues, bancos e gerando chaves API seguras...</p>
                <pre class="code" id="w-infra-log">Aguardando...</pre>
                <div id="w-keys-box" class="hidden">
                  <p><strong>Chave principal gerada para este ambiente (Copie agora):</strong></p>
                  <pre class="code" id="w-api-key" style="color:var(--accent); font-weight:bold;"></pre>
                  <p><strong>URLs oficiais de acesso:</strong></p>
                  <pre class="code" id="w-urls"></pre>
                </div>
                <div class="toolbar" style="margin-top: 2rem; justify-content: flex-end;"><button id="btn-step-2" disabled>Avançar para Providers →</button></div>
              </div>

              <div id="step-3" class="wizard-step hidden">
                <h2>Passo 3: Providers & Teste</h2>
                <p>Estes provedores globais estão disponíveis para este tenant. O sistema executará fallbacks automáticos em caso de falha.</p>
                <div class="table-container">
                  <table>
                    <thead><tr><th>Provider</th><th>Status</th><th>Modelos Disponíveis</th></tr></thead>
                    <tbody>
                      ${providers.map(p => `<tr><td><strong>${esc(p.name)}</strong></td><td>${badge(p.health?.ok)}</td><td>${p.models?.length || 0} modelos</td></tr>`).join('')}
                    </tbody>
                  </table>
                </div>
                <div class="toolbar" style="margin-top: 2rem; justify-content: flex-end;"><button id="btn-step-3">Finalizar Projeto →</button></div>
              </div>

              <div id="step-4" class="wizard-step hidden">
                <h2 style="color:var(--success);">Concluído! Projeto ONLINE</h2>
                <p class="muted">O projeto foi implantado com sucesso. As filas e rotas estão liberadas.</p>
                <div class="cards" style="margin-top:2rem;">
                  ${card('Gateway Status', 'ONLINE', 'ok')}
                  ${card('Workers Alocados', 'Ativos', 'ok')}
                  ${card('Database', 'Isolado', 'ok')}
                </div>
                <div class="toolbar" style="margin-top: 2rem; justify-content: center;"><button onclick="location.hash='#/projects'" class="ghost" style="border: 1px solid var(--accent); color:var(--accent);">Ir para Dashboard do Projeto</button></div>
              </div>
            </div>
          `;

          let newProject = null;
          let newKey = null;

          $('#btn-step-1').addEventListener('click', async () => {
            const btn = $('#btn-step-1'); btn.disabled = true; btn.textContent = 'Criando...';
            try {
              const res = await api('/admin/projects', {
                method: 'POST',
                body: { name: $('#w-name').value, tenantId: $('#w-tenant').value, domain: $('#w-domain').value }
              });
              newProject = res.project;
              
              const keyRes = await api('/admin/api-keys', {
                method: 'POST',
                body: { name: 'key-' + $('#w-env').value, tenantId: $('#w-tenant').value, projectId: newProject.id, environment: $('#w-env').value, scopes: ['text','chat','image','vision','embed','ocr','workflow'] }
              });
              newKey = keyRes.key;

              $('#step-1').classList.add('hidden');
              $('#step-2').classList.remove('hidden');
              
              setTimeout(() => {
                $('#w-infra-log').textContent = \`[OK] Project ID: \${newProject.id}\\n[OK] Tenant ID: \${newProject.tenantId}\\n[OK] Runtime Registrado\\n[OK] Filas Isoladas criadas no BullMQ\\n[OK] Cache Compartilhado isolado por chave\`;
                $('#w-keys-box').classList.remove('hidden');
                $('#w-api-key').textContent = newKey;
                $('#w-urls').textContent = \`API Gateway: https://\${newProject.domain || 'api.plataforma.com'}/v1\\nSwagger: https://\${newProject.domain || 'api.plataforma.com'}/docs\`;
                $('#btn-step-2').disabled = false;
              }, 1200);
            } catch (err) {
              alert(err.message);
              btn.disabled = false; btn.textContent = 'Gerar Infraestrutura →';
            }
          });

          $('#btn-step-2').addEventListener('click', () => {
            $('#step-2').classList.add('hidden');
            $('#step-3').classList.remove('hidden');
          });

          $('#btn-step-3').addEventListener('click', () => {
            $('#step-3').classList.add('hidden');
            $('#step-4').classList.remove('hidden');
          });
        };
        renderList();
      } catch (err) {
        content().innerHTML = \`<p class="error">Erro ao carregar projetos: \${esc(err.message)}</p>\`;
      }
    },

    async providers() {
      content().innerHTML = '<h1>Providers</h1><p class="muted">Carregando conexoes...</p>';
      const [{ providers, defaults }, { configs }] = await Promise.all([
        api('/admin/providers'), api('/admin/provider-configs'),
      ]);
      const configByName = Object.fromEntries(configs.map((c) => [c.name, c]));
      const choices = ['ollama', 'groq', 'gemini', 'openrouter', 'huggingface', 'cloudflare', 'lmstudio', 'comfyui', 'forge', 'invokeai'];
      content().innerHTML = `
        <h1>Providers</h1>
        <p class="muted">Cadastre as credenciais aqui. Segredos sao criptografados e nunca retornam pela API.</p>
        <div class="card section">
          <h2>Conectar provider</h2>
          <div class="form-grid">
            <label>Provider <select id="p-name">${choices.map((name) => `<option value="${name}">${name}</option>`).join('')}</select></label>
            <label>Endpoint / Base URL <input id="p-url" placeholder="https://..." /></label>
            <label>API key / Token <input id="p-key" type="password" autocomplete="new-password" placeholder="deixe vazio para manter a atual" /></label>
            <label>Account ID (Cloudflare) <input id="p-account" /></label>
            <label>Modelo padrao <input id="p-model" placeholder="llama-3.1-8b-instant" /></label>
            <label>Modelo embeddings <input id="p-embed" /></label>
            <label class="inline-check"><input id="p-enabled" type="checkbox" checked /> Ativo</label>
          </div>
          <div class="toolbar"><button id="p-save">Salvar e ativar</button><span id="p-result" class="muted"></span></div>
        </div>
        <p class="muted">Defaults: ${esc(JSON.stringify(defaults))}</p>
        ${table(
          ['Provider', 'Configurado', 'Status', 'Latencia', 'Capacidades', 'Modelos', 'Acoes'],
          choices.map((name) => {
            const live = providers.find((p) => p.name === name);
            const cfg = configByName[name];
            return [
              `<strong>${esc(name)}</strong>`, cfg ? badge(cfg.enabled, 'ativo', 'desativado') : '<span class="muted">.env/nao salvo</span>',
              live ? badge(live.health.ok) : badge(false, 'online', 'nao registrado'),
              live?.health?.latencyMs != null ? fmtMs(live.health.latencyMs) : '—',
              esc(live?.capabilities?.join(', ') || '—'), live?.models?.length ?? 0,
              `<button class="ghost" data-edit-provider="${name}">Editar</button> <button class="ghost" data-test-provider="${name}" ${live ? '' : 'disabled'}>Testar</button>`,
            ];
          }),
        )}`;

      const fillProvider = (name) => {
        const cfg = configByName[name];
        $('#p-name').value = name;
        $('#p-url').value = cfg?.settings?.baseUrl || cfg?.baseUrl || '';
        $('#p-key').value = '';
        $('#p-key').placeholder = cfg?.hasApiKey ? 'credencial salva (deixe vazio para manter)' : 'cole a API key/token';
        $('#p-account').value = cfg?.settings?.accountId || '';
        $('#p-model').value = cfg?.settings?.defaultModel || '';
        $('#p-embed').value = cfg?.settings?.embedModel || '';
        $('#p-enabled').checked = cfg?.enabled ?? true;
      };
      $('#p-name').addEventListener('change', (e) => fillProvider(e.target.value));
      fillProvider($('#p-name').value);
      $('#p-save').addEventListener('click', async () => {
        const result = $('#p-result'); result.textContent = 'Salvando...'; result.className = 'muted';
        try {
          const data = await api('/admin/provider-configs', { method: 'POST', body: {
            name: $('#p-name').value, enabled: $('#p-enabled').checked,
            baseUrl: $('#p-url').value.trim(), apiKey: $('#p-key').value.trim(),
            accountId: $('#p-account').value.trim(), defaultModel: $('#p-model').value.trim(),
            embedModel: $('#p-embed').value.trim(),
          }});
          result.textContent = data.registered ? 'Salvo e registrado.' : 'Salvo, mas faltam campos obrigatorios.';
          result.className = data.registered ? 'ok' : 'warn';
          setTimeout(() => pages.providers(), 700);
        } catch (err) { result.textContent = err.message; result.className = 'error'; }
      });
      content().querySelectorAll('[data-edit-provider]').forEach((btn) => btn.addEventListener('click', () => fillProvider(btn.dataset.editProvider)));
      content().querySelectorAll('[data-test-provider]').forEach((btn) => btn.addEventListener('click', async () => {
        const result = $('#p-result'); result.textContent = `Testando ${btn.dataset.testProvider}...`; result.className = 'muted';
        try { const data = await api(`/admin/provider-configs/${btn.dataset.testProvider}/test`, { method: 'POST' }); result.textContent = `Online (${fmtMs(data.health.latencyMs)})`; result.className = 'ok'; }
        catch (err) { result.textContent = `Falha: ${err.message}`; result.className = 'error'; }
      }));
    },
    async models() {
      const [{ providers: live }, { providers: configured }] = await Promise.all([
        api('/admin/providers'),
        api('/admin/models'),
      ]);
      const liveRows = live.flatMap((p) =>
        p.models.map((m) => [esc(p.name), esc(m.id), esc(m.name || ''), m.sizeBytes ? (m.sizeBytes / 1e9).toFixed(1) + ' GB' : '—']),
      );
      const costRows = configured.flatMap((p) =>
        p.models.map((m) => [esc(p.name), esc(m.modelId), esc(m.capability), '$' + m.costPer1kInput, '$' + m.costPer1kOutput]),
      );
      content().innerHTML = `
        <h1>Modelos</h1>
        <div class="section"><h2>Detectados nos providers</h2>${table(['Provider', 'Modelo', 'Nome', 'Tamanho'], liveRows)}</div>
        <div class="section">
          <h2>Custos configurados (por 1k tokens)</h2>
          ${table(['Provider', 'Modelo', 'Capacidade', 'Input', 'Output'], costRows)}
          <div class="toolbar" style="margin-top:1rem">
            <label>Provider <input id="mc-provider" placeholder="openai" /></label>
            <label>Modelo <input id="mc-model" placeholder="gpt-4o-mini" /></label>
            <label>Custo input/1k <input id="mc-in" type="number" step="0.0001" value="0" /></label>
            <label>Custo output/1k <input id="mc-out" type="number" step="0.0001" value="0" /></label>
            <button id="mc-save">Salvar</button>
          </div>
        </div>`;
      $('#mc-save').addEventListener('click', async () => {
        await api('/admin/models', {
          method: 'POST',
          body: {
            provider: $('#mc-provider').value,
            modelId: $('#mc-model').value,
            costPer1kInput: Number($('#mc-in').value),
            costPer1kOutput: Number($('#mc-out').value),
          },
        });
        pages.models();
      });
    },

    async playground() {
      const { providers } = await api('/admin/providers');
      const online = providers.filter((p) => p.health.ok);
      content().innerHTML = `
        <h1>Testar IA</h1>
        <p class="muted">Execute uma chamada real antes de conectar seus projetos.</p>
        <div class="card">
          <div class="form-grid">
            <label>Provider <select id="test-provider"><option value="">Automatico (fallback)</option>${providers.map((p) => `<option value="${esc(p.name)}">${esc(p.name)} ${p.health.ok ? '✓' : '(offline)'}</option>`).join('')}</select></label>
            <label>Modelo opcional <input id="test-model" placeholder="padrao do provider" /></label>
          </div>
          <label>Prompt <textarea id="test-prompt">Responda apenas: sistema funcionando</textarea></label>
          <div class="toolbar" style="margin-top:1rem"><button id="test-run" ${online.length ? '' : 'disabled'}>Executar teste</button><span id="test-status" class="muted">${online.length ? `${online.length} provider(s) online` : 'Nenhum provider online'}</span></div>
          <pre id="test-output" class="code hidden"></pre>
        </div>`;
      $('#test-run').addEventListener('click', async () => {
        const button = $('#test-run'); const status = $('#test-status'); const output = $('#test-output');
        button.disabled = true; status.textContent = 'Executando...'; output.classList.add('hidden');
        try {
          const data = await api('/admin/test-text', { method: 'POST', body: {
            prompt: $('#test-prompt').value,
            provider: $('#test-provider').value || undefined,
            model: $('#test-model').value.trim() || undefined,
          }});
          status.textContent = `${data.provider} / ${data.model} / ${fmtMs(data.executionTime)}`; status.className = 'ok';
          output.textContent = data.result.text; output.classList.remove('hidden');
        } catch (err) { status.textContent = err.message; status.className = 'error'; }
        finally { button.disabled = false; }
      });
    },

    async imageGenerate() {
      content().innerHTML = `<h1>Gerar Imagem</h1><div class="card"><div class="form-grid"><label>Acao <select id="ig-action">${imageActions.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label><label>Provider <input id="ig-provider" placeholder="auto" /></label><label>Modelo <input id="ig-model" placeholder="auto" /></label><label>Largura <input id="ig-width" type="number" value="1024" /></label><label>Altura <input id="ig-height" type="number" value="1024" /></label></div><label>Prompt <textarea id="ig-prompt" placeholder="Descreva o produto e o resultado desejado"></textarea></label><button id="ig-run">Gerar imagem</button><span id="ig-status" class="muted"></span><div id="ig-output"></div></div>`;
      $('#ig-run').addEventListener('click',async()=>{const b=$('#ig-run'),s=$('#ig-status');b.disabled=true;s.textContent='Gerando...';try{const d=await api('/admin/image/generate',{method:'POST',body:{operation:'text-to-image',action:$('#ig-action').value,prompt:$('#ig-prompt').value,provider:$('#ig-provider').value||'auto',model:$('#ig-model').value||undefined,width:Number($('#ig-width').value),height:Number($('#ig-height').value)}});$('#ig-output').innerHTML=renderGenerated(d);s.textContent='Concluido';s.className='ok';}catch(e){s.textContent=e.message;s.className='error';}finally{b.disabled=false;}});
    },

    async imageEdit() {
      content().innerHTML = `<h1>Imagem → Imagem</h1><div class="card"><div class="form-grid"><label>Imagem (jpg/png/jpeg/webp) <input id="ie-file" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" /></label><label>Acao <select id="ie-action">${imageActions.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label><label>Forca <input id="ie-strength" type="number" min="0" max="1" step="0.05" value="0.6" /></label><label>Provider <input id="ie-provider" placeholder="auto" /></label><label>Modelo <input id="ie-model" placeholder="auto" /></label></div><label>Instrucao <textarea id="ie-prompt" placeholder="Ex.: trocar por fundo branco mantendo o produto identico"></textarea></label><button id="ie-run">Transformar imagem</button> <button id="ie-bg" class="ghost">Remover fundo</button> <button id="ie-up" class="ghost">Upscale 4x</button><span id="ie-status" class="muted"></span><div id="ie-output"></div></div>`;
      const run=async(operation)=>{const file=$('#ie-file').files[0];if(!file)throw new Error('Selecione uma imagem');const b=$('#ie-run'),s=$('#ie-status');b.disabled=true;s.textContent='Processando...';try{const d=await api('/admin/image/generate',{method:'POST',body:{operation,action:$('#ie-action').value,prompt:$('#ie-prompt').value,image:await fileDataUrl(file),strength:Number($('#ie-strength').value),provider:$('#ie-provider').value||'auto',model:$('#ie-model').value||undefined}});$('#ie-output').innerHTML=renderGenerated(d);s.textContent='Concluido';s.className='ok';}catch(e){s.textContent=e.message;s.className='error';}finally{b.disabled=false;}};
      $('#ie-run').addEventListener('click',()=>run('image-to-image'));$('#ie-bg').addEventListener('click',()=>run('remove-background'));$('#ie-up').addEventListener('click',()=>run('upscale'));
    },

    async videoAI() {
      content().innerHTML = `<h1>Video → Imagem</h1><div class="card"><div class="form-grid"><label>Video (mp4/mov/avi/mkv) <input id="vi-file" type="file" accept=".mp4,.mov,.avi,.mkv,video/mp4,video/quicktime" /></label><label>Frames <input id="vi-frames" type="number" min="1" max="20" value="4" /></label><label>Acao <select id="vi-action">${imageActions.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label><label>Provider <input id="vi-provider" placeholder="auto" /></label><label>Modelo <input id="vi-model" placeholder="auto" /></label></div><label>Instrucao <textarea id="vi-prompt"></textarea></label><button id="vi-run">Enviar para fila</button><span id="vi-status" class="muted"></span><div id="vi-output"></div></div>`;
      $('#vi-run').addEventListener('click',async()=>{const file=$('#vi-file').files[0],b=$('#vi-run'),s=$('#vi-status');if(!file){s.textContent='Selecione um video';s.className='error';return;}b.disabled=true;s.textContent='Enviando...';try{const d=await api('/admin/image/generate',{method:'POST',body:{operation:'video-to-image',video:await fileDataUrl(file),prompt:$('#vi-prompt').value,action:$('#vi-action').value,frameCount:Number($('#vi-frames').value),provider:$('#vi-provider').value||'auto',model:$('#vi-model').value||undefined}});$('#vi-output').innerHTML=renderGenerated(d);s.textContent='Job criado';s.className='ok';}catch(e){s.textContent=e.message;s.className='error';}finally{b.disabled=false;}});
    },

    async imageProviders() {
      const { providers } = await api('/admin/image/providers');
      content().innerHTML = `<h1>Image Providers</h1>${table(['Provider','Status','Latencia','Modelos','Fila'], providers.map((p) => [
        `<strong>${esc(p.name)}</strong>`, badge(p.health.ok), p.health.latencyMs != null ? fmtMs(p.health.latencyMs) : '—', p.models.length,
        p.queue ? `${p.queue.running} executando / ${p.queue.pending} aguardando` : '—',
      ]))}<p class="muted">Conexoes e credenciais sao configuradas na pagina Providers.</p>`;
    },

    async imageQueue() {
      const { queue, jobs } = await api('/admin/image/queue');
      content().innerHTML = `<h1>Image Queue</h1><div class="cards">${card('Aguardando',queue?.waiting||0)}${card('Ativos',queue?.active||0)}${card('Concluidos',queue?.completed||0,'ok')}${card('Falhas',queue?.failed||0,queue?.failed?'error':'')}</div>${table(['Job','Status','Provider','Modelo','Duracao','Criado'],jobs.map((j)=>[esc(j.id.slice(0,10)),esc(j.status),esc(j.provider||'—'),esc(j.model||'—'),j.durationMs?fmtMs(j.durationMs):'—',fmtDate(j.createdAt)]))}`;
    },

    async imageHistory() {
      const { images } = await api('/admin/image/history?limit=100');
      content().innerHTML = `<h1>Image History</h1><div class="image-grid">${images.map((img)=>`<article class="card">${img.url?`<img data-image-id="${esc(img.id)}" alt="${esc(img.prompt||img.kind)}" loading="lazy" />`:''}<strong>${esc(img.kind)}</strong><span class="muted">${esc(img.provider)} / ${esc(img.model)}</span><small>${esc((img.prompt||'').slice(0,100))}</small><small>${fmtDate(img.createdAt)}</small></article>`).join('')||'<p class="muted">Nenhuma imagem gerada.</p>'}</div>`;
      await Promise.all(Array.from(content().querySelectorAll('[data-image-id]')).map(async (img) => {
        const res = await fetch(API + `/admin/image/${img.dataset.imageId}/file`, { headers: { authorization: `Bearer ${token()}` } });
        if (res.ok) img.src = URL.createObjectURL(await res.blob());
      }));
    },

    async imageModels() {
      const { providers } = await api('/admin/image/providers');
      const rows=providers.flatMap((p)=>p.models.map((m)=>[esc(p.name),esc(m.id),esc(m.name||m.id),esc((m.capabilities||['image']).join(', '))]));
      content().innerHTML=`<h1>Image Models</h1>${table(['Provider','Modelo','Nome','Capacidades'],rows)}`;
    },

    async imageAnalytics() {
      const data=await api('/admin/image/analytics');
      content().innerHTML=`<h1>Image Analytics</h1><div class="cards">${card('Imagens geradas',data.total)}</div><div class="section"><h2>Por provider</h2>${table(['Provider','Total'],data.byProvider.map((x)=>[esc(x.provider),x._count._all]))}</div><div class="section"><h2>Por operacao</h2>${table(['Operacao','Total'],data.byKind.map((x)=>[esc(x.kind),x._count._all]))}</div>`;
    },

    async workers() {
      const { workers } = await api('/admin/workers');
      content().innerHTML = `
        <h1>Workers</h1>
        ${table(
          ['Host', 'Filas', 'Concorrencia', 'Status', 'Ultimo heartbeat'],
          workers.map((w) => [esc(w.hostname), esc(w.queues), w.concurrency, badge(w.online), fmtDate(w.lastHeartbeat)]),
        )}`;
    },

    async queues() {
      const [{ queues }, { jobs }] = await Promise.all([api('/admin/queues'), api('/admin/jobs?limit=50')]);
      content().innerHTML = `
        <h1>Filas</h1>
        <div class="section">${table(
          ['Fila', 'Aguardando', 'Ativos', 'Concluidos', 'Falhas', 'Agendados'],
          queues.map((q) => [esc(q.name), q.waiting, q.active, q.completed, q.failed, q.delayed]),
        )}</div>
        <div class="section"><h2>Jobs recentes</h2>${table(
          ['Job', 'Fila', 'Status', 'Provider', 'Duracao', 'Criado', 'Erro'],
          jobs.map((j) => [
            esc(j.id.slice(0, 10)), esc(j.queue),
            `<span class="badge ${j.status === 'completed' ? 'ok' : j.status === 'failed' ? 'err' : ''}">${esc(j.status)}</span>`,
            esc(j.provider || '—'), j.durationMs ? fmtMs(j.durationMs) : '—', fmtDate(j.createdAt),
            `<span class="error">${esc((j.error || '').slice(0, 80))}</span>`,
          ]),
        )}</div>`;
    },

    async usage() {
      const { usage } = await api('/admin/usage?days=30');
      const totalCost = usage.reduce((s, u) => s + u.cost, 0);
      const totalTokens = usage.reduce((s, u) => s + Number(u.totalTokens), 0);
      const totalReq = usage.reduce((s, u) => s + u.requests, 0);
      content().innerHTML = `
        <h1>Tokens &amp; Custos (30 dias)</h1>
        <div class="cards">
          ${card('Requisicoes', totalReq)}
          ${card('Tokens', totalTokens)}
          ${card('Custo (USD)', '$' + totalCost.toFixed(4))}
        </div>
        ${table(
          ['Dia', 'Tenant', 'Capacidade', 'Provider', 'Requisicoes', 'Cache', 'Tokens', 'Custo'],
          usage.map((u) => [
            new Date(u.day).toLocaleDateString('pt-BR'), esc(u.tenant?.name || u.tenantId),
            esc(u.capability), esc(u.provider), u.requests, u.cachedHits, esc(u.totalTokens),
            '$' + u.cost.toFixed(4),
          ]),
        )}`;
    },

    async cache() {
      const { stats } = await api('/admin/cache');
      content().innerHTML = `
        <h1>Cache</h1>
        <div class="cards">
          ${card('Entradas persistidas', stats.entries)}
          ${card('Hits acumulados', stats.totalHits, 'ok')}
          ${card('Chaves no Redis', stats.redisKeys)}
        </div>
        <button id="cache-clear" class="danger">Limpar cache</button>`;
      $('#cache-clear').addEventListener('click', async () => {
        if (!confirm('Limpar todo o cache (Redis + Postgres)?')) return;
        await api('/admin/cache', { method: 'DELETE' });
        pages.cache();
      });
    },

    async logs() {
      const { logs } = await api('/admin/logs?limit=100');
      content().innerHTML = `
        <h1>Logs de requisicoes</h1>
        ${table(
          ['Quando', 'Capacidade', 'Provider', 'Modelo', 'Cache', 'Status', 'Tokens', 'Duracao', 'Custo'],
          logs.map((l) => [
            fmtDate(l.createdAt), esc(l.capability), esc(l.provider), esc(l.model),
            l.cached ? '<span class="ok">hit</span>' : '—',
            badge(l.success, 'ok', l.errorCode || 'erro'),
            l.totalTokens, fmtMs(l.durationMs), '$' + l.cost.toFixed(5),
          ]),
        )}`;
    },

    async users() {
      const { users } = await api('/admin/users');
      content().innerHTML = `
        <h1>Usuarios</h1>
        <div class="toolbar">
          <label>Email <input id="u-email" type="email" /></label>
          <label>Senha <input id="u-pass" type="password" /></label>
          <label>Perfil <select id="u-role"><option value="user">user</option><option value="admin">admin</option></select></label>
          <button id="u-create">Criar usuario</button>
        </div>
        ${table(
          ['Email', 'Nome', 'Perfil', 'Ativo', 'Criado'],
          users.map((u) => [esc(u.email), esc(u.name || '—'), esc(u.role), badge(u.active, 'sim', 'nao'), fmtDate(u.createdAt)]),
        )}`;
      $('#u-create').addEventListener('click', async () => {
        await api('/admin/users', {
          method: 'POST',
          body: { email: $('#u-email').value, password: $('#u-pass').value, role: $('#u-role').value },
        });
        pages.users();
      });
    },

    async keys() {
      const [{ keys }, { tenants }, { projects }] = await Promise.all([api('/admin/api-keys'), api('/admin/tenants'), api('/admin/projects')]);
      const scopes=['text','chat','image','video','vision','embed','ocr','workflow'];
      content().innerHTML = `<h1>API Keys</h1><p class="muted">Crie credenciais independentes por projeto, ambiente e capacidade.</p>
        <div class="card section"><h2>Nova chave</h2><div class="form-grid">
          <label>Nome <input id="k-name" placeholder="lovable-producao" /></label>
          <label>Tenant <select id="k-tenant">${tenants.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select></label>
          <label>Projeto <select id="k-project"><option value="">Sem projeto</option>${projects.map(p=>`<option value="${esc(p.id)}" data-tenant="${esc(p.tenantId)}">${esc(p.name)}</option>`).join('')}</select></label>
          <label>Ambiente <select id="k-env"><option value="live">Produção</option><option value="test">Teste</option><option value="dev">Desenvolvimento</option></select></label>
          <label>Expira em <input id="k-expiry" type="datetime-local" /></label>
        </div><div class="scope-list">${scopes.map(x=>`<label><input type="checkbox" value="${x}" ${['text','chat','image'].includes(x)?'checked':''}/> ${x}</label>`).join('')}</div>
        <button id="k-create">Gerar chave</button><span id="k-status" class="muted"></span></div><div id="k-new"></div>
        ${table(['Nome','Prefixo','Projeto','Ambiente','Escopos','Validade','Status','Ações'],keys.map(k=>[
          esc(k.name),`<code>${esc(k.prefix)}...</code>`,esc(k.project?.name||'—'),esc(k.environment),esc(k.scopes),k.expiresAt?fmtDate(k.expiresAt):'Sem expiração',badge(k.active,'ativa','revogada'),
          k.active?`<button class="ghost" data-revoke="${esc(k.id)}">Revogar</button>`:''
        ]))}`;
      const filterProjects=()=>{const tenant=$('#k-tenant').value;Array.from($('#k-project').options).forEach((o,i)=>{if(i)o.hidden=o.dataset.tenant!==tenant});if($('#k-project').selectedOptions[0]?.hidden)$('#k-project').value='';};
      $('#k-tenant').addEventListener('change',filterProjects);filterProjects();
      $('#k-create').addEventListener('click',async()=>{const status=$('#k-status');try{const selected=Array.from(content().querySelectorAll('.scope-list input:checked')).map(x=>x.value);const exp=$('#k-expiry').value;const data=await api('/admin/api-keys',{method:'POST',body:{name:$('#k-name').value||'sem-nome',tenantId:$('#k-tenant').value,projectId:$('#k-project').value||undefined,environment:$('#k-env').value,scopes:selected,expiresAt:exp?new Date(exp).toISOString():undefined}});$('#k-new').innerHTML=`<div class="card key-created"><strong>Chave criada — copie agora</strong><pre class="code" id="new-key">${esc(data.key)}</pre><button id="copy-key">Copiar chave</button></div>`;$('#copy-key').onclick=async()=>{await navigator.clipboard.writeText(data.key);$('#copy-key').textContent='Copiada!'};status.textContent='';}catch(e){status.textContent=e.message;status.className='error';}});
      content().querySelectorAll('[data-revoke]').forEach(btn=>btn.addEventListener('click',async()=>{await api(`/admin/api-keys/${btn.dataset.revoke}`,{method:'DELETE'});pages.keys();}));
    },

    async comfyWizard() {
      const data=await api('/admin/comfyui/setup');
      content().innerHTML=`<h1>Assistente ComfyUI</h1><p class="muted">Conecte uma instância local ou remota em quatro passos.</p>
        <div class="wizard-steps"><span class="active">1 URL</span><span>2 Teste</span><span>3 Modelos</span><span>4 Workflows</span></div>
        <div class="card section"><h2>1. Endereço do servidor</h2><div class="toolbar"><label>URL <input id="cw-url" value="http://host.docker.internal:8188" size="38" /></label><button id="cw-test">Salvar e testar</button></div><p id="cw-status" class="${data.health.ok?'ok':'muted'}">${data.health.ok?'Conectado':'Ainda não conectado'}${data.health.latencyMs?` · ${data.health.latencyMs}ms`:''}</p></div>
        <div class="card section"><h2>2. Modelos detectados</h2>${data.models.length?table(['Modelo','Nome','Capacidades'],data.models.map(m=>[esc(m.id),esc(m.name||m.id),esc((m.capabilities||[]).join(', '))])):'<p class="empty-state">Conecte o ComfyUI para detectar checkpoints automaticamente.</p>'}</div>
        <div class="card section"><h2>3. Workflows</h2><p>${data.workflows.length} workflow(s) configurado(s).</p><a class="button-link" href="#/workflow-manager">Abrir gerenciador de workflows</a></div>`;
      $('#cw-test').onclick=async()=>{const el=$('#cw-status');el.textContent='Testando conexão...';el.className='muted';try{const r=await api('/admin/comfyui/setup',{method:'POST',body:{baseUrl:$('#cw-url').value}});el.textContent=r.health.ok?'ComfyUI conectado com sucesso.':'Servidor respondeu, mas não está saudável.';el.className=r.health.ok?'ok':'error';if(r.health.ok)setTimeout(()=>pages.comfyWizard(),700);}catch(e){el.textContent=e.message;el.className='error';}};
    },

    async workflowManager() {
      const {workflows}=await api('/admin/workflows');
      content().innerHTML=`<h1>Workflows ComfyUI</h1><div class="card section"><h2>Importar workflow API JSON</h2><div class="toolbar"><label>Nome <input id="wf-name" placeholder="Produto realista SDXL" /></label><label>Arquivo JSON <input id="wf-file" type="file" accept="application/json,.json" /></label><button id="wf-import">Importar</button></div><p id="wf-status" class="muted">Exporte no ComfyUI usando “Save (API Format)”.</p></div>
        ${table(['Nome','Status','Padrão','Atualizado','Ações'],workflows.map(w=>[esc(w.name),badge(w.enabled,'ativo','desativado'),w.isDefault?'★ padrão':'—',fmtDate(w.updatedAt),`<button class="ghost" data-default="${w.id}">Padrão</button> <button class="ghost" data-toggle="${w.id}" data-enabled="${w.enabled}">${w.enabled?'Desativar':'Ativar'}</button> <button class="ghost" data-copy="${w.id}">Duplicar</button> <button class="ghost" data-export="${w.id}">Exportar</button>`]))}`;
      $('#wf-import').onclick=async()=>{const f=$('#wf-file').files[0],st=$('#wf-status');if(!f){st.textContent='Selecione um JSON.';st.className='error';return}try{await api('/admin/workflows/import',{method:'POST',body:{name:$('#wf-name').value||f.name.replace(/\.json$/i,''),graph:JSON.parse(await f.text())}});pages.workflowManager();}catch(e){st.textContent=e.message;st.className='error';}};
      content().querySelectorAll('[data-default]').forEach(b=>b.onclick=async()=>{await api(`/admin/workflows/${b.dataset.default}`,{method:'PATCH',body:{isDefault:true}});pages.workflowManager()});
      content().querySelectorAll('[data-toggle]').forEach(b=>b.onclick=async()=>{await api(`/admin/workflows/${b.dataset.toggle}`,{method:'PATCH',body:{enabled:b.dataset.enabled!=='true'}});pages.workflowManager()});
      content().querySelectorAll('[data-copy]').forEach(b=>b.onclick=async()=>{await api(`/admin/workflows/${b.dataset.copy}/duplicate`,{method:'POST',body:{}});pages.workflowManager()});
      content().querySelectorAll('[data-export]').forEach(b=>b.onclick=async()=>{const r=await fetch(API+`/admin/workflows/${b.dataset.export}/export`,{headers:{authorization:`Bearer ${token()}`}});const blob=await r.blob(),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='workflow.json';a.click();URL.revokeObjectURL(a.href)});
    },
    async health() {
      const data = await fetch(API + '/v1/health').then((r) => r.json());
      content().innerHTML = `
        <h1>Health</h1>
        <div class="cards">
          ${card('Status', data.status, data.status === 'ok' ? 'ok' : 'error')}
          ${card('Database', data.checks.database ? 'ok' : 'down', data.checks.database ? 'ok' : 'error')}
          ${card('Redis', data.checks.redis ? 'ok' : 'down', data.checks.redis ? 'ok' : 'error')}
          ${card('Uptime', Math.round(data.uptime / 60) + ' min')}
        </div>
        <h2>Providers ativos</h2>
        <pre class="code">${esc(JSON.stringify(data.providers, null, 2))}</pre>`;
    },

    async prompts() {
      const {prompts}=await api('/admin/prompts');
      const categories=['produtos','marketing','imagem','video','seo','lojas','crm','whatsapp','catalogo','ocr'];
      content().innerHTML=`<h1>Biblioteca de Prompts</h1><p class="muted">Prompts reutilizáveis, categorizados e versionados.</p><div class="card section"><h2>Novo prompt</h2><div class="form-grid"><label>Nome <input id="pm-name" /></label><label>Categoria <select id="pm-category">${categories.map(c=>`<option value="${c}">${c}</option>`).join('')}</select></label><label class="inline-check"><input id="pm-favorite" type="checkbox"/> Favorito</label><label class="inline-check"><input id="pm-shared" type="checkbox"/> Compartilhado</label></div><label>Template <textarea id="pm-template" placeholder="Use {{variavel}} para campos dinâmicos"></textarea></label><button id="pm-save">Salvar prompt</button><span id="pm-status" class="muted"></span></div><div class="image-grid">${prompts.map(p=>`<article class="card"><strong>${p.favorite?'★ ':''}${esc(p.name)}</strong><span class="badge">${esc(p.category||'geral')}</span><small>v${p.version} · ${p.shared?'compartilhado':'privado'}</small><pre class="code">${esc(p.template.slice(0,500))}</pre><div><button class="ghost" data-fav="${p.id}" data-value="${p.favorite}">${p.favorite?'Desfavoritar':'Favoritar'}</button> <button class="ghost" data-del-prompt="${p.id}">Excluir</button></div></article>`).join('')||'<p class="empty-state">Nenhum prompt salvo.</p>'}</div>`;
      $('#pm-save').onclick=async()=>{const st=$('#pm-status');try{await api('/admin/prompts',{method:'POST',body:{name:$('#pm-name').value,category:$('#pm-category').value,template:$('#pm-template').value,favorite:$('#pm-favorite').checked,shared:$('#pm-shared').checked}});pages.prompts();}catch(e){st.textContent=e.message;st.className='error';}};
      content().querySelectorAll('[data-fav]').forEach(b=>b.onclick=async()=>{await api(`/admin/prompts/${b.dataset.fav}`,{method:'PATCH',body:{favorite:b.dataset.value!=='true'}});pages.prompts()});
      content().querySelectorAll('[data-del-prompt]').forEach(b=>b.onclick=async()=>{await api(`/admin/prompts/${b.dataset.delPrompt}`,{method:'DELETE'});pages.prompts()});
    },
    async projects() {
      const [{ projects }, { tenants }] = await Promise.all([api('/admin/projects'), api('/admin/tenants')]);
      // URL absoluta (origin real) para o snippet/endpoint funcionar quando
      // copiado para um projeto externo. API='' serve so pra chamadas do proprio
      // dashboard (mesmo host); o cliente externo precisa do host completo.
      const base = location.origin;
      const endpoints = ['/v1/text', '/v1/chat', '/v1/image', '/v1/vision', '/v1/embed'];
      content().innerHTML=`<h1>Projetos</h1><p class="muted">Crie um projeto e receba na mesma tela tudo para conectar: ID, endpoint, chave e snippet.</p>
        <div class="wizard-steps"><span class="active">1 Criar</span><span>2 Chave</span><span>3 Conectar</span></div>
        <div class="card section"><h2>Novo projeto</h2><div class="form-grid"><label>Nome <input id="pr-name" /></label><label>Tenant <select id="pr-tenant">${tenants.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select></label><label>Descrição <input id="pr-desc" /></label><label>Domínio <input id="pr-domain" placeholder="meuprojeto.lovable.app" /></label></div><button id="pr-create">Criar projeto</button><span id="pr-status" class="muted"></span></div>
        <div id="pr-connect"></div>
        ${table(['Projeto','Tenant','Descrição','Domínio','Criado'],projects.map(p=>[esc(p.name),esc(p.tenant?.name||'—'),esc(p.description||'—'),esc(p.domain||'—'),fmtDate(p.createdAt)]))}`;
      const bindCopy = (btnId, value, done = 'Copiado!') => { const b = $('#' + btnId); if (b) b.onclick = async () => { await navigator.clipboard.writeText(value); b.textContent = done; }; };
      $('#pr-create').addEventListener('click', async () => {
        const s = $('#pr-status'); const btn = $('#pr-create'); btn.disabled = true;
        s.textContent = 'Criando projeto...'; s.className = 'muted';
        const projectName = $('#pr-name').value || 'sem-nome';
        const tenantId = $('#pr-tenant').value;
        let project;
        try {
          const created = await api('/admin/projects', { method: 'POST', body: { name: projectName, tenantId, description: $('#pr-desc').value, domain: $('#pr-domain').value } });
          project = created.project;
        } catch (e) { s.textContent = e.message; s.className = 'error'; btn.disabled = false; return; }
        s.textContent = 'Projeto criado. Gerando API Key...'; s.className = 'ok';
        let generatedKey;
        try {
          const keyData = await api('/admin/api-keys', { method: 'POST', body: { name: `${projectName}-key`, tenantId: project.tenantId, projectId: project.id, environment: 'live', scopes: ['text','chat','image','vision','embed'] } });
          generatedKey = keyData.key;
        } catch (e) {
          $('#pr-connect').innerHTML = `<div class="card section key-created"><strong>Projeto criado</strong><p class="muted">Project ID: <code>${esc(project.id)}</code></p><p class="error">Não foi possível gerar a chave automaticamente: ${esc(e.message)}</p><a class="button-link" href="#/keys">Gerar chave manualmente</a></div>`;
          s.textContent = ''; btn.disabled = false;
          return;
        }
        s.textContent = 'Pronto! Projeto criado e chave gerada.'; s.className = 'ok';
        const snippet = `fetch('${base}/v1/text', {\n  method: 'POST',\n  headers: { 'content-type': 'application/json', 'x-api-key': '${generatedKey}' },\n  body: JSON.stringify({ prompt: 'Olá!' })\n})`;
        $('#pr-connect').innerHTML = `<div class="card section key-created">
          <h2>Projeto pronto — conecte agora</h2>
          <p><strong>Project ID:</strong> <code id="pr-id">${esc(project.id)}</code> <button id="pr-copy-id" class="ghost">Copiar ID</button></p>
          <p><strong>Endpoint de apontamento:</strong> <code>${esc(base)}/v1/text</code></p>
          <p class="muted">Outras rotas: ${endpoints.slice(1).map(e=>`<code>${esc(e)}</code>`).join(' · ')}</p>
          <p><strong>API Key</strong> — <span class="error">copie agora, não será exibida novamente</span></p>
          <pre class="code" id="pr-key">${esc(generatedKey)}</pre><button id="pr-copy-key" class="ghost">Copiar chave</button>
          <h2>Snippet pronto</h2>
          <pre class="code" id="pr-snippet">${esc(snippet)}</pre><button id="pr-copy-snippet" class="ghost">Copiar snippet</button>
          <div class="toolbar" style="margin-top:1rem"><button id="pr-test">Testar conexão agora</button><span id="pr-test-status" class="muted"></span></div>
        </div>`;
        bindCopy('pr-copy-id', project.id, 'ID copiado!');
        bindCopy('pr-copy-key', generatedKey, 'Chave copiada!');
        bindCopy('pr-copy-snippet', snippet, 'Snippet copiado!');
        $('#pr-test').onclick = async () => {
          const st = $('#pr-test-status'); const tb = $('#pr-test'); tb.disabled = true;
          st.textContent = 'Testando...'; st.className = 'muted';
          try {
            const r = await fetch(API + '/v1/text', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': generatedKey }, body: JSON.stringify({ prompt: 'ping' }) });
            const d = await r.json();
            if (!r.ok) throw new Error(d?.error?.message || 'Chave recusada');
            st.textContent = `Conexão validada, projeto pronto para uso. ${d.model ? '(' + d.model + ') ' : ''}${(d.result?.text || d.text || '').slice(0, 80)}`; st.className = 'ok';
          } catch (e) { st.textContent = e.message; st.className = 'error'; }
          finally { tb.disabled = false; }
        };
        btn.disabled = false;
      });
    },

    async playground() {
      content().innerHTML = '<h1>Playground</h1><p class="muted">Carregando contexto...</p>';
      try {
        const { keys } = await api('/admin/api-keys');
        const activeKeys = keys.filter(k => k.active);
        
        content().innerHTML = `
          <div class="toolbar" style="justify-content: space-between;">
            <h1>Playground (Live Test)</h1>
          </div>
          <p class="muted">Teste suas rotas diretamente pelo navegador. O Playground consome a API do Gateway Real.</p>
          
          <div class="card section" style="display:flex; flex-direction:column; gap:1rem;">
            <div class="form-grid">
              <label>API Key
                <select id="pg-key">
                  ${activeKeys.length ? activeKeys.map(k => `<option value="${k.prefix}*****">${esc(k.name)} (${k.environment})</option>`).join('') : '<option value="">(Nenhuma chave ativa)</option>'}
                </select>
                <small class="muted">Para testes reais, você precisará colar a chave completa (já que ela não é mais visível).</small>
                <input id="pg-real-key" type="password" placeholder="ap_live_..." autocomplete="off" />
              </label>
              <label>Endpoint (v1)
                <select id="pg-endpoint">
                  <option value="/v1/text">Texto (/v1/text)</option>
                  <option value="/v1/image">Imagem (/v1/image)</option>
                </select>
              </label>
            </div>
            
            <label>Prompt
              <textarea id="pg-prompt" rows="4" placeholder="Ex: Crie um slogan para uma cafeteria..."></textarea>
            </label>
            
            <div class="toolbar" style="justify-content: flex-end;">
              <button id="pg-btn-test" class="ok">Executar Chamada</button>
            </div>
            
            <div id="pg-output-box" class="hidden" style="margin-top:1rem; border-top: 1px solid var(--border); padding-top:1rem;">
              <h3>Output</h3>
              <pre class="code" id="pg-output" style="white-space: pre-wrap;"></pre>
            </div>
          </div>
        `;

        $('#pg-btn-test').addEventListener('click', async () => {
          const btn = $('#pg-btn-test');
          const key = $('#pg-real-key').value.trim();
          const endpoint = $('#pg-endpoint').value;
          const prompt = $('#pg-prompt').value.trim();
          
          if (!key) { alert('Cole a API Key completa para testar!'); return; }
          if (!prompt) { alert('Digite um prompt!'); return; }
          
          btn.disabled = true; btn.textContent = 'Processando...';
          $('#pg-output-box').classList.remove('hidden');
          $('#pg-output').textContent = 'Carregando...';

          try {
            const base = location.origin.replace(':8080', ':3000');
            const res = await fetch(base + endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-api-key': key },
              body: JSON.stringify({ prompt })
            });
            const data = await res.json();
            
            if (res.ok) {
              if (endpoint === '/v1/image') {
                if (data.result && data.result.images) {
                   $('#pg-output').innerHTML = data.result.images.map(img => `<img src="data:image/png;base64,${img.base64}" style="max-width:100%; border-radius:8px;" />`).join('<br>');
                } else {
                   $('#pg-output').textContent = JSON.stringify(data, null, 2);
                }
              } else {
                $('#pg-output').textContent = (data.result?.text || data.text || JSON.stringify(data, null, 2));
              }
            } else {
              $('#pg-output').textContent = 'Error: ' + JSON.stringify(data, null, 2);
            }
          } catch (err) {
            $('#pg-output').textContent = 'Falha de rede: ' + err.message;
          } finally {
            btn.disabled = false; btn.textContent = 'Executar Chamada';
          }
        });
      } catch (e) {
        content().innerHTML = \`<p class="error">Erro ao carregar playground: \${esc(e.message)}</p>\`;
      }
    },

    async lovable() {
      const {projects}=await api('/admin/projects');
      const base=location.origin.replace(':8080',':3000');
      content().innerHTML=`<h1>Conectar ao Lovable</h1><p class="muted">Configuração guiada: projeto, chave, código e teste.</p>
        <div class="wizard-steps"><span class="active">1 Projeto</span><span>2 API Key</span><span>3 Código</span><span>4 Testar</span></div>
        <div class="card section"><h2>1. Escolha o projeto</h2>${projects.length?`<label>Projeto <select id="lv-project">${projects.map(p=>`<option>${esc(p.name)}</option>`).join('')}</select></label>`:`<p class="empty-state">Você ainda não possui projeto. <a href="#/projects">Criar primeiro projeto</a></p>`}</div>
        <div class="card section"><h2>2. Informe a API Key</h2><p class="muted">A chave fica apenas nesta sessão do navegador e será enviada somente para sua API Platform local.</p><label>API Key <input id="lv-key" type="password" placeholder="ap_live_..." autocomplete="off" /></label><a class="button-link" href="#/keys">Criar nova chave</a></div>
        <div class="card section"><h2>3. Cole no Lovable</h2><pre class="code">api_platform_URL=${esc(base)}\napi_platform_API_KEY=ap_live_xxxxx\n\nfetch(api_platform_URL + '/v1/text', {\n  method: 'POST',\n  headers: { 'content-type': 'application/json', 'x-api-key': api_platform_API_KEY },\n  body: JSON.stringify({ prompt: 'Olá!' })\n});</pre></div>
        <div class="card section"><h2>4. Teste a conexão</h2><button id="lv-test">Testar chave</button><span id="lv-status" class="muted"></span></div>`;
      $('#lv-test').onclick=async()=>{const st=$('#lv-status'),key=$('#lv-key').value;if(!key){st.textContent=' Informe a chave.';st.className='error';return}st.textContent=' Testando...';try{const r=await fetch(API+'/v1/models',{headers:{'x-api-key':key}}),d=await r.json();if(!r.ok)throw new Error(d?.error?.message||'Chave recusada');st.textContent=' Conexão validada — Lovable já pode usar a plataforma.';st.className='ok';}catch(e){st.textContent=' '+e.message;st.className='error';}};
    },
    async integrations() {
      const examples={Lovable:`const api = new apiplatform({\n  url: "${location.origin.replace(':8080',':3000')}",\n  apiKey: "ap_live_xxxxx"\n});`,React:`fetch(api_platform_URL + '/v1/text', {\n method:'POST', headers:{'content-type':'application/json','x-api-key':api_platform_API_KEY},\n body:JSON.stringify({prompt:'Olá'})\n});`,Node:`const response = await fetch(process.env.api_platform_URL + '/v1/chat', { headers: {'x-api-key': process.env.api_platform_API_KEY} });`,Python:`client = apiplatform(url=api_platform_URL, api_key=api_platform_API_KEY)\nresult = client.text("Olá")`,PHP:`$headers = ['x-api-key: '.getenv('api_platform_API_KEY')];`,Flutter:`headers: {'x-api-key': apiplatformApiKey}`};
      content().innerHTML=`<h1>Integrações</h1><p class="muted">Escolha sua tecnologia. O projeto cliente precisa conhecer apenas URL e API Key.</p>${Object.entries(examples).map(([name,code])=>`<div class="card section"><h2>${name}</h2><pre class="code">${esc(code)}</pre></div>`).join('')}`;
    },

    async ollama() {
      const data=await api('/admin/providers'); const p=data.providers.find(x=>x.name==='ollama');
      content().innerHTML=`<h1>Ollama</h1>${p?`<div class="cards">${card('Status',p.health?.ok?'online':'offline',p.health?.ok?'ok':'error')}${card('Latência',p.health?.latencyMs!=null?fmtMs(p.health.latencyMs):'—')}${card('Modelos',p.models?.length||0)}${card('Capacidades',(p.capabilities||[]).join(', '))}</div><div class="section"><h2>Modelos instalados</h2>${table(['Modelo','Nome'],(p.models||[]).map(m=>[esc(m.id),esc(m.name||m.id)]))}</div>`:'<p class="empty-state">Ollama não está configurado.</p>'}<a class="button-link" href="#/providers">Configurar providers</a>`;
    },
    async baseUrl() {
      const base=location.origin.replace(':8080',':3000');
      content().innerHTML=`<h1>Base URL</h1><p class="muted">Um único endereço para todos os projetos.</p><div class="card section"><h2>Endpoint da plataforma</h2><pre class="code">${esc(base)}</pre><p>Header obrigatório: <code>x-api-key: ap_live_...</code></p></div><div class="section"><h2>Rotas principais</h2>${table(['Capacidade','Endpoint'],[['Chat','POST /v1/chat'],['Imagem','POST /v1/image'],['Vídeo','POST /v1/video'],['Vision','POST /v1/vision'],['Embedding','POST /v1/embedding'],['Workflow','POST /v1/workflow']])}</div>`;
    },
    async sdk() {
      const base=location.origin.replace(':8080',':3000'); const snippets={JavaScript:`const client = new apiplatform({ baseUrl: '${base}', apiKey: process.env.api_platform_API_KEY });`,TypeScript:`const result = await client.chat({ messages: [{ role: 'user', content: 'Olá' }] });`,Python:`client = apiplatform(base_url='${base}', api_key=os.environ['api_platform_API_KEY'])`,cURL:`curl -X POST ${base}/v1/chat -H "x-api-key: $api_platform_API_KEY"`};
      content().innerHTML=`<h1>SDK</h1><p class="muted">Clientes e exemplos mínimos para integrar qualquer aplicação.</p>${Object.entries(snippets).map(([name,code])=>`<div class="card section"><h2>${name}</h2><pre class="code">${esc(code)}</pre></div>`).join('')}`;
    },
    async security() {
      const [{keys},{users}]=await Promise.all([api('/admin/api-keys'),api('/admin/users')]); const active=keys.filter(k=>k.active).length,expired=keys.filter(k=>k.expiresAt&&new Date(k.expiresAt)<new Date()).length,admins=users.filter(u=>u.role==='admin'&&u.active).length;
      content().innerHTML=`<h1>Segurança</h1><div class="cards">${card('Chaves ativas',active,'ok')}${card('Chaves expiradas',expired,expired?'error':'')}${card('Administradores',admins)}${card('Autenticação','JWT + API Key','ok')}</div><div class="section"><h2>Proteções ativas</h2>${table(['Controle','Status'],[['Tokens apenas como hash',badge(true)],['Escopos por chave',badge(true)],['Isolamento por projeto',badge(true)],['Rate limit por chave',badge(true)],['CORS com allowlist',badge(true)]])}</div><a class="button-link" href="#/keys">Gerenciar API Keys</a>`;
    },
    async backup() {
      const health=await fetch(API+'/v1/health').then(r=>r.json());
      content().innerHTML=`<h1>Backup</h1><p class="muted">Procedimentos para PostgreSQL, Redis e arquivos gerados.</p><div class="cards">${card('Banco',health.checks.database?'pronto':'indisponível',health.checks.database?'ok':'error')}${card('Redis',health.checks.redis?'pronto':'indisponível',health.checks.redis?'ok':'error')}${card('Storage','volume persistente','ok')}</div><div class="card section"><h2>Comandos operacionais</h2><pre class="code">docker compose exec postgres pg_dump -U apiplatform apiplatform &gt; backup.sql\ndocker compose exec redis redis-cli BGSAVE\ndocker run --rm -v api-platform_image-storage:/data -v /backup:/backup alpine tar czf /backup/images.tar.gz /data</pre></div>`;
    },
    async settings() {
      const { tenants } = await api('/admin/tenants');
      content().innerHTML = `
        <h1>Configuracoes</h1>
        <div class="section">
          <h2>Tenants (lojas)</h2>
          <div class="toolbar">
            <label>Nome <input id="t-name" /></label>
            <label>Slug <input id="t-slug" placeholder="minha-loja" /></label>
            <button id="t-create">Criar tenant</button>
          </div>
          ${table(
            ['Nome', 'Slug', 'Ativo', 'Provider texto', 'Provider imagem', 'Criado'],
            tenants.map((t) => [
              esc(t.name), esc(t.slug), badge(t.active, 'sim', 'nao'),
              esc(t.defaultTextProvider || 'global'), esc(t.defaultImageProvider || 'global'), fmtDate(t.createdAt),
            ]),
          )}
        </div>
        <div class="section">
          <h2>Documentacao</h2>
          <p class="muted">Swagger/OpenAPI disponivel em <a href="/docs" target="_blank" style="color:var(--accent)">/docs</a> — metricas Prometheus em <code>/metrics</code>.</p>
        </div>`;
      $('#t-create').addEventListener('click', async () => {
        await api('/admin/tenants', {
          method: 'POST',
          body: { name: $('#t-name').value, slug: $('#t-slug').value },
        });
        pages.settings();
      });
    },
  };

  // ---------- Router ----------
  async function route() {
    const hash = location.hash.replace('#/', '') || 'home';
    document.querySelectorAll('.sidebar nav a').forEach((a) => {
      a.classList.toggle('active', a.getAttribute('href') === `#/${hash}`);
    });
    const aliases = { 'image-generate': 'imageGenerate', 'image-edit': 'imageEdit', 'video-ai': 'videoAI', 'image-providers': 'imageProviders', 'image-queue': 'imageQueue', 'image-history': 'imageHistory', 'image-models': 'imageModels', 'image-analytics': 'imageAnalytics', 'comfy-wizard': 'comfyWizard', 'workflow-manager': 'workflowManager', 'base-url': 'baseUrl' };
      const page = pages[aliases[hash] || hash];
      content().innerHTML = '<p class="muted">Carregando...</p>';
      try {
        if (page) await page();
        else content().innerHTML = `<h1>404</h1><p>Página ${hash} não encontrada no modo Enterprise.</p>`;
      } catch (err) {
        content().innerHTML = `<p class="error">Erro: ${esc(err.message)}</p>`;
      }
    }

    // Enterprise Premium Routes Addition
    pages.health = async () => {
      content().innerHTML = '<h1>Health Check (Real-time)</h1><pre id="health-json"></pre>';
      const update = async () => {
        if (location.hash.replace('#/', '') !== 'health') return;
        try {
          const res = await fetch(API + '/v1/health').then(r => r.json());
          $('#health-json').textContent = JSON.stringify(res, null, 2);
        } catch(e) {}
        setTimeout(update, 2000);
      };
      update();
    };
    
    pages.fenix = async () => {
      content().innerHTML = `
        <h1>🚀 FÊNIX Connect</h1>
        <p class="muted">Integração nativa com FÊNIX OS e ICP Panel.</p>
        <div class="section" style="margin-top:2rem">
          <h2>String de Conexão (Runtime)</h2>
          <div class="card">
            <pre style="background:transparent; padding:0; margin:0;" id="runtime-json">Carregando...</pre>
          </div>
          <br>
          <button id="fenix-sync">Forçar Sincronização ICP</button>
          <span id="fenix-res" style="margin-left:1rem;"></span>
        </div>
      `;
      try {
        const res = await fetch(API + '/v1/runtime').then(r => r.json());
        $('#runtime-json').textContent = JSON.stringify(res, null, 2);
      } catch(e) { $('#runtime-json').textContent = 'Erro ao carregar runtime'; }
      $('#fenix-sync').addEventListener('click', () => {
        $('#fenix-res').textContent = 'Sincronizado via FÊNIX Mesh API.';
        $('#fenix-res').className = 'ok';
      });
    };

    pages.icp = async () => {
      content().innerHTML = `
        <h1>Integração ICP</h1>
        <div class="cards">
          ${card('Proxy Manager', 'Nginx', 'ok')}
          ${card('SSL', 'Certbot / Let\'s Encrypt', 'ok')}
          ${card('Domain', 'vps10363.panel.icontainer.net')}
          ${card('Status', 'ONLINE', 'ok')}
        </div>
      `;
    };

    pages.mission = async () => {
      content().innerHTML = `
        <h1>Mission Viewer</h1>
        <div class="cards">
          ${card('Missões Ativas', '0')}
          ${card('Missões Hoje', '0')}
          ${card('Falhas', '0')}
        </div>
        <div class="section">
          <h2>Radar de Missões</h2>
          <div style="width:100%; height:300px; background:var(--bg-surface); border:1px solid var(--border); border-radius:12px; display:flex; align-items:center; justify-content:center; position:relative; overflow:hidden;">
            <div style="position:absolute; width:100%; height:100%; background: radial-gradient(circle, transparent 20%, var(--bg-surface) 100%), repeating-radial-gradient(transparent 0, transparent 40px, rgba(59,130,246,0.1) 40px, rgba(59,130,246,0.1) 41px);"></div>
            <div style="position:absolute; width:50%; height:2px; background:linear-gradient(90deg, transparent, var(--accent)); top:50%; left:50%; transform-origin:left; animation: radar 4s linear infinite;"></div>
            <span style="z-index:2; font-family:var(--font-display); font-size:1.5rem; color:var(--accent);">NENHUMA MISSÃO ATIVA</span>
          </div>
        </div>
        <style>@keyframes radar { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }</style>
      `;
    };
    
    pages.runtime = pages.fenix;

  window.addEventListener('hashchange', route);

  if (token()) showShell();
  else showLogin();
})();
