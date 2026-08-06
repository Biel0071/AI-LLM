import { ExecutionGateway } from '../apps/api/src/services/execution-gateway.service';

async function runTests() {
  console.log('--- Iniciando Testes do Gateway Hardening ---');

  // Teste 1: Payload Massivo (Testa compressao)
  console.log('Teste 1: Payload Massivo (Compressao de Contexto)');
  try {
    const hugeMessage = { role: 'user', content: 'hello '.repeat(20000) }; // aprox 20k tokens
    const { ctx, response } = await ExecutionGateway.execute('test-tenant', {
      messages: [hugeMessage],
      model: 'qwen2.5:3b', // modelo barato/rapido p/ teste
      stream: false
    });
    console.log('OK! Payload comprimido e roteado com sucesso.');
    console.log('Trace eventos:', ctx.trace?.map((t: any) => t.type));
  } catch (e: any) {
    console.error('Falhou Teste 1', e.message);
  }

  console.log('Todos os testes concluidos!');
}

runTests().catch(console.error);
