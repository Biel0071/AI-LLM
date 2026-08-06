/**
 * Estimador de tokens usando heurísticas rápidas.
 * 
 * Heurísticas baseadas em inglês (aprox 4 caracteres por token) e pt-br/código (aprox 3.5).
 * Em produção real com recursos sobrando, poderíamos embutir o `tiktoken`, 
 * mas uma divisão simples atende bem como proxy rápido para decisões de roteamento.
 */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  
  // Detecção ingênua de código (muitas quebras de linha e caracteres especiais)
  const isCode = text.includes('```') || text.includes('function') || text.includes('const ') || text.includes('import ');
  
  const charLength = text.length;
  // Código ou textos complexos costumam gerar mais tokens por caractere
  const charsPerToken = isCode ? 3.5 : 4.0;
  
  return Math.ceil(charLength / charsPerToken);
}

/**
 * Calcula estimativa total para um payload inteiro do tipo Chat.
 */
export function estimatePayloadTokens(messages: Array<{ role: string, content: string | any[] }>, system?: string | any[]): number {
  let totalChars = 0;

  if (system) {
    if (typeof system === 'string') {
      totalChars += system.length;
    } else if (Array.isArray(system)) {
      totalChars += system.filter((b: any) => b.type === 'text').reduce((acc: number, b: any) => acc + (b.text?.length || 0), 0);
    }
  }

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      totalChars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      totalChars += msg.content.filter((b: any) => b.type === 'text').reduce((acc: number, b: any) => acc + (b.text?.length || 0), 0);
    }
  }

  // 1 token por mensagem (overhead do formato de chat)
  const overheadTokens = messages.length * 4 + 2; 

  const isCode = (totalChars > 0 && typeof messages[messages.length - 1]?.content === 'string') 
    ? (messages[messages.length - 1].content as string).includes('```') 
    : false;
  
  const charsPerToken = isCode ? 3.5 : 4.0;

  return Math.ceil(totalChars / charsPerToken) + overheadTokens;
}

/**
 * Comprime o contexto de forma inteligente para caber no `maxTokens`.
 * Preserva system, developer, chamadas de tools e as ultimas mensagens.
 */
export function compressContext(
  messages: Array<{ role: string, content: string | any[], [key: string]: any }>,
  maxTokens: number,
  system?: string | any[]
): { compressedMessages: typeof messages, compressedSystem: typeof system } {
  let currentTokens = estimatePayloadTokens(messages, system);
  if (currentTokens <= maxTokens) {
    return { compressedMessages: messages, compressedSystem: system };
  }

  const margin = 500; // Margem de seguranca
  const targetTokens = Math.max(0, maxTokens - margin);
  let resultMessages = [...messages];
  let resultSystem = system;

  // 1. Tentar comprimir as mensagens do meio
  // Mantemos sempre a primeira (se for developer) e as ultimas N mensagens.
  // Tool calls e tool results nao devem ser removidos se possivel.
  
  const isCritical = (m: any) => m.role === 'developer' || m.role === 'system' || m.tool_calls || m.tool_call_id;
  
  // Vamos primeiro tentar remover as mensagens mais antigas que nao sao criticas
  // Pula a ultima (que eh a instrucao atual do usuario) e a penultima (contexto recente)
  
  let i = 0;
  while (currentTokens > targetTokens && resultMessages.length > 2 && i < resultMessages.length - 2) {
    const msg = resultMessages[i];
    if (!isCritical(msg)) {
      // Remover a mensagem ou encurtar drasticamente
      if (typeof msg.content === 'string' && msg.content.length > 500) {
        // Encurtar
        msg.content = msg.content.substring(0, 200) + '\\n... [Conteudo resumido pelo AI Gateway] ...\\n' + msg.content.substring(msg.content.length - 200);
      } else {
        // Remover
        resultMessages.splice(i, 1);
        i--; // ajustar indice apos remocao
      }
      currentTokens = estimatePayloadTokens(resultMessages, resultSystem);
    }
    i++;
  }

  // 2. Se ainda estiver acima, tentar comprimir mensagens de tool (resultados muito longos)
  if (currentTokens > targetTokens) {
    for (let j = 0; j < resultMessages.length - 1; j++) {
      const msg = resultMessages[j];
      if (msg.role === 'tool' || msg.tool_call_id) {
        if (typeof msg.content === 'string' && msg.content.length > 1000) {
          msg.content = msg.content.substring(0, 500) + '\\n... [Tool Output truncado] ...\\n' + msg.content.substring(msg.content.length - 500);
          currentTokens = estimatePayloadTokens(resultMessages, resultSystem);
        }
      }
      if (currentTokens <= targetTokens) break;
    }
  }

  // 3. Se ainda estiver acima, truncar o system prompt
  if (currentTokens > targetTokens && resultSystem) {
    if (typeof resultSystem === 'string') {
      const charsAllowed = Math.max(100, (targetTokens - estimatePayloadTokens(resultMessages)) * 3.5);
      if (resultSystem.length > charsAllowed) {
        resultSystem = resultSystem.substring(0, Math.floor(charsAllowed)) + '\\n\\n... [System prompt truncado pelo AI Gateway para caber na janela do modelo]';
      }
    }
  }

  // 4. Último caso, truncar a ultima mensagem do usuario
  currentTokens = estimatePayloadTokens(resultMessages, resultSystem);
  if (currentTokens > targetTokens) {
    const lastMsg = resultMessages[resultMessages.length - 1];
    if (lastMsg && typeof lastMsg.content === 'string') {
      const charsAllowed = Math.max(100, targetTokens * 3.5);
      if (lastMsg.content.length > charsAllowed) {
        lastMsg.content = lastMsg.content.substring(0, Math.floor(charsAllowed)) + '\\n\\n... [Payload final truncado pelo AI Gateway]';
      }
    }
  }

  return { compressedMessages: resultMessages, compressedSystem: resultSystem };
}
