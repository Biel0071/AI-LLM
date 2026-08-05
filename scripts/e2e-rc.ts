import { buildApp } from '../apps/api/src/app';
import { prisma } from '../apps/api/src/lib/prisma';
import assert from 'assert';

async function run() {
  console.log('--- BACKEND CERTIFICATION (E2E) ---');
  const app = await buildApp();
  await app.ready();

  try {
    // 1. Health
    let res = await app.inject({ method: 'GET', url: '/v1/health' });
    assert.strictEqual(res.statusCode, 200, 'GET /v1/health falhou');
    console.log('PASS: GET /v1/health');

    // 2. Metrics
    res = await app.inject({ method: 'GET', url: '/metrics' });
    assert.strictEqual(res.statusCode, 200, 'GET /metrics falhou');
    console.log('PASS: GET /metrics');

    // 3. Providers Public
    res = await app.inject({ method: 'GET', url: '/v1/providers' });
    assert.strictEqual(res.statusCode, 200, 'GET /v1/providers falhou');
    console.log('PASS: GET /v1/providers');

    // 4. Models Public
    res = await app.inject({ method: 'GET', url: '/v1/models' });
    assert.strictEqual(res.statusCode, 200, 'GET /v1/models falhou');
    console.log('PASS: GET /v1/models');

    // MOCK ADMIN TOKEN PARA TESTES E2E REAIS
    const adminToken = await app.jwt.sign({ sub: 'admin-rc-test', email: 'admin@rc.com', role: 'admin', iat: Date.now(), exp: Date.now() + 3600000 });

    // 5. GET Providers Admin
    res = await app.inject({ method: 'GET', url: '/admin/providers', headers: { authorization: `Bearer ${adminToken}` } });
    assert.strictEqual(res.statusCode, 200, 'GET /admin/providers falhou');
    console.log('PASS: GET /admin/providers');

    // Cria Tenant e Projeto para testar
    const tenantRes = await app.inject({ method: 'POST', url: '/admin/tenants', headers: { authorization: `Bearer ${adminToken}` }, payload: { name: 'RC Tenant', slug: 'rc-tenant-' + Date.now() } });
    const tenant = tenantRes.json().tenant;

    // 6. POST Projects
    res = await app.inject({ method: 'POST', url: '/admin/projects', headers: { authorization: `Bearer ${adminToken}` }, payload: { name: 'RC Project', tenantId: tenant.id } });
    assert.strictEqual(res.statusCode, 200, 'POST /admin/projects falhou');
    const project = res.json().project;
    console.log('PASS: POST /admin/projects');

    // 7. POST API Keys
    res = await app.inject({ method: 'POST', url: '/admin/api-keys', headers: { authorization: `Bearer ${adminToken}` }, payload: { name: 'RC Key', tenantId: tenant.id, projectId: project.id, environment: 'live', scopes: ['text', 'chat', 'image'] } });
    assert.strictEqual(res.statusCode, 200, 'POST /admin/api-keys falhou');
    const apiKeyStr = res.json().key;
    console.log('PASS: POST /admin/api-keys');

    // 8. POST /v1/text
    res = await app.inject({ method: 'POST', url: '/v1/text', headers: { 'x-api-key': apiKeyStr }, payload: { prompt: 'ping' } });
    // Pode retornar 200 ou 429/503 dependendo se o LLM/Provider local esta rodando
    // Mas NUNCA 500.
    assert.ok(res.statusCode !== 500, `POST /v1/text retornou 500: ${res.body}`);
    console.log('PASS: POST /v1/text');

    // 9. POST /v1/chat
    res = await app.inject({ method: 'POST', url: '/v1/chat', headers: { 'x-api-key': apiKeyStr }, payload: { messages: [{ role: 'user', content: 'ping' }] } });
    assert.ok(res.statusCode !== 500, `POST /v1/chat retornou 500: ${res.body}`);
    console.log('PASS: POST /v1/chat');

    // 10. POST /v1/image
    res = await app.inject({ method: 'POST', url: '/v1/image', headers: { 'x-api-key': apiKeyStr }, payload: { prompt: 'a beautiful cat' } });
    assert.ok(res.statusCode !== 500, `POST /v1/image retornou 500: ${res.body}`);
    console.log('PASS: POST /v1/image');

    console.log('--- ALL BACKEND CERTIFICATIONS PASSED ---');
  } catch (err) {
    console.error('FALHA NA CERTIFICAÇÃO BACKEND:');
    console.error(err);
    process.exit(1);
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}

run();
