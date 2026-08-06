import fetch from 'node-fetch';

async function runTests() {
  console.log('--- Iniciando Testes do Gateway Hardening HTTP ---');

  const hugeMessage = { role: 'user', content: 'hello '.repeat(30000) }; // approx 30k tokens
  
  try {
    const res = await fetch('http://localhost:3000/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'groq/llama-3.3-70b-versatile',
        messages: [hugeMessage],
        stream: false
      })
    });

    console.log('Status HTTP:', res.status);
    const data = await res.json();
    console.log('Resposta:', data.choices?.[0]?.message?.content?.substring(0, 100) + '...');
    
  } catch (e: any) {
    console.error('Falhou Teste HTTP:', e.message);
  }

  console.log('Todos os testes concluidos!');
}

runTests().catch(console.error);
