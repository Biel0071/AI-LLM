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
