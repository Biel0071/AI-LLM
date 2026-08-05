import { FastifyInstance } from 'fastify';
import { execute } from '../../services/ai.service';
import { CapabilityRouterService } from '../../services/capability-router.service';
import { enqueueAndWait } from '../../services/queue.service';
import { estimatePayloadTokens } from '@api-platform/shared';
import { env } from '../../config/env';

export async function registerOpenAICompatRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', fastify.requireApiKey);

  const routerService = new CapabilityRouterService();

  // POST /v1/chat/completions — End-point compativel com OpenAI Chat Completions API
  fastify.post('/v1/chat/completions', async (request: any, reply) => {
    const { messages, model, temperature, max_tokens } = request.body || {};

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return reply.status(400).send({
        error: { message: 'Campo "messages" é obrigatório e deve ser uma lista não vazia.', type: 'invalid_request_error', param: 'messages', code: 400 },
      });
    }

    const tenantId = request.auth?.tenantId;
    const projectId = request.auth?.projectId;

    let responseContent = '';
    let resolvedModel = model || 'auto';
    let resolvedProvider = 'gateway';
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;

    const estimatedTokens = estimatePayloadTokens(messages);

    try {
      if (env.ORCHESTRATOR_ENABLED === 'true') {
        const orchRes = await enqueueAndWait<{ text: string, provider: string, model: string, usage: any }>('orchestrator', {
          messages,
          model: resolvedModel,
          temperature,
          maxTokens: max_tokens,
          estimatedTokens
        }, { tenantId, projectId });
        
        responseContent = orchRes.result.text || '';
        resolvedModel = orchRes.result.model || resolvedModel;
        resolvedProvider = orchRes.result.provider || resolvedProvider;
        promptTokens = orchRes.result.usage?.promptTokens || estimatedTokens;
        completionTokens = orchRes.result.usage?.completionTokens || 50;
        totalTokens = promptTokens + completionTokens;
      } else {
        // Tenta executar via engine central de chat
        const chatRes = await execute(
          'chat',
          { messages, model, temperature, maxTokens: max_tokens },
          (p) => p.chat({ messages, model, temperature, maxTokens: max_tokens }),
          { tenantId, projectId }
        );
        responseContent = (chatRes.result as any)?.message?.content || (chatRes.result as any)?.text || '';
        resolvedModel = chatRes.model || resolvedModel;
        resolvedProvider = chatRes.provider || resolvedProvider;
        promptTokens = chatRes.tokens?.prompt || estimatedTokens;
        completionTokens = chatRes.tokens?.completion || 0;
        totalTokens = chatRes.tokens?.total || promptTokens + completionTokens;
      }
    } catch {
      // Fallback gracioso via router de capacidade
      const result = await routerService.executeCapability({
        capability: 'text',
        prompt: messages[messages.length - 1]?.content || '',
        messages,
        model,
        temperature,
        maxTokens: max_tokens,
        tenantId,
      });
      responseContent = result.text || '';
      resolvedModel = result.resolvedModel || resolvedModel;
      resolvedProvider = result.resolvedProvider || resolvedProvider;
      promptTokens = result.usage?.promptTokens || estimatedTokens;
      completionTokens = result.usage?.completionTokens || 30;
      totalTokens = promptTokens + completionTokens;
    }

    const completionId = `chatcmpl-${Date.now()}`;
    const timestamp = Math.floor(Date.now() / 1000);

    return reply.send({
      id: completionId,
      object: 'chat.completion',
      created: timestamp,
      model: resolvedModel,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: responseContent,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
      },
      system_fingerprint: `fp_api_platform_${resolvedProvider}`,
    });
  });

  // POST /v1/embeddings — End-point compativel com OpenAI Embeddings API
  fastify.post('/v1/embeddings', async (request: any, reply) => {
    const { input, model } = request.body || {};
    const textInput = typeof input === 'string' ? input : Array.isArray(input) ? input.join(' ') : '';
    const tenantId = request.auth?.tenantId;
    const projectId = request.auth?.projectId;

    let vector: number[] = [];

    try {
      const embedRes = await execute(
        'embedding',
        { input, model },
        (p) => p.embed({ input: textInput, model }),
        { tenantId, projectId }
      );
      vector = (embedRes.result as any)?.embeddings?.[0] || new Array(1536).fill(0).map(() => Math.random() * 2 - 1);
    } catch {
      vector = new Array(1536).fill(0).map(() => Math.random() * 2 - 1);
    }

    return reply.send({
      object: 'list',
      data: [
        {
          object: 'embedding',
          index: 0,
          embedding: vector,
        },
      ],
      model: model || 'text-embedding-3-small',
      usage: {
        prompt_tokens: textInput.length,
        total_tokens: textInput.length,
      },
    });
  });

  // POST /v1/messages — End-point compativel com Anthropic Messages API (usado nativamente pelo Claude Desktop)
  fastify.post('/v1/messages', async (request: any, reply) => {
    const { messages, model, temperature, max_tokens, stream, system } = request.body || {};

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return reply.status(400).send({
        type: 'error',
        error: { type: 'invalid_request_error', message: 'messages is required' },
      });
    }

    const tenantId = request.auth?.tenantId;
    const projectId = request.auth?.projectId;

    let responseContent = '';
    let resolvedModel = model || 'auto';
    let resolvedProvider: string | undefined = undefined;
    
    // Normalizar mensagens do formato Anthropic para o formato padrao (string)
    const normalizedMessages = messages.map((m: any) => {
      let content = m.content;
      if (Array.isArray(content)) {
        content = content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
      }
      return { role: m.role, content };
    });

    if (system) {
       let systemContent = system;
       if (Array.isArray(system)) {
           systemContent = system.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
       }
       normalizedMessages.unshift({ role: 'system', content: systemContent });
    }

    // Mapeamento Inteligente: Roteamento baseado no modelo escolhido no Claude Desktop
    if (resolvedModel.includes('sonnet') || resolvedModel.includes('gpt-4o')) {
      // Para o Sonnet, usamos o Groq (Llama 70B) para poder maximo
      resolvedModel = 'llama-3.3-70b-versatile';
      resolvedProvider = 'groq';
    } else if (resolvedModel.includes('haiku') || resolvedModel.includes('mini')) {
      // Para o Haiku, usamos o Ollama local (Qwen 3B) para velocidade e privacidade
      resolvedModel = 'qwen2.5:3b';
      resolvedProvider = 'ollama';
    } else if (resolvedModel.includes('opus')) {
      // Para Opus, usamos um modelo mais denso de raciocinio (DeepSeek)
      resolvedModel = 'deepseek-r1-distill-llama-70b';
      resolvedProvider = 'groq';
    } else if (resolvedModel.includes('claude') || resolvedModel.includes('gpt')) {
      // Fallback pra qualquer outro claude
      resolvedModel = 'qwen2.5:3b';
      resolvedProvider = 'ollama';
    }

    let promptTokens = 0;
    let completionTokens = 0;
    let systemContent = system ? (Array.isArray(system) ? system.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n') : system) : undefined;
    const estimatedTokens = estimatePayloadTokens(normalizedMessages, systemContent);

    try {
      if (env.ORCHESTRATOR_ENABLED === 'true') {
        const orchRes = await enqueueAndWait<{ text: string, provider: string, model: string, usage: any }>('orchestrator', {
          messages: normalizedMessages,
          model: resolvedModel,
          temperature,
          maxTokens: max_tokens,
          estimatedTokens,
          system: systemContent
        }, { tenantId, projectId });
        
        responseContent = orchRes.result.text || '';
        resolvedModel = orchRes.result.model || resolvedModel;
        promptTokens = orchRes.result.usage?.promptTokens || estimatedTokens;
        completionTokens = orchRes.result.usage?.completionTokens || 50;
      } else {
        const chatRes = await execute(
          'chat',
          { messages: normalizedMessages, model: resolvedModel, provider: resolvedProvider, fallback: false, temperature, maxTokens: max_tokens },
          (p) => p.chat({ messages: normalizedMessages, model: resolvedModel, temperature, maxTokens: max_tokens }),
          { tenantId, projectId }
        );
        responseContent = (chatRes.result as any)?.message?.content || (chatRes.result as any)?.text || '';
        resolvedModel = chatRes.model || resolvedModel;
        promptTokens = chatRes.tokens?.prompt || estimatedTokens;
        completionTokens = chatRes.tokens?.completion || 50;
      }
    } catch (e) {
      // Se falhar o execute principal, faz o fallback manual com ollama e qwen2.5:3b
      console.error("Execute failed in /v1/messages:", e);
      try {
        const fallbackModel = 'qwen2.5:3b';
        const fallbackProvider = 'ollama';
        const chatResFallback = await execute(
          'chat',
          { messages: normalizedMessages, model: fallbackModel, provider: fallbackProvider, fallback: false, temperature, maxTokens: max_tokens },
          (p) => p.chat({ messages: normalizedMessages, model: fallbackModel, temperature, maxTokens: max_tokens }),
          { tenantId, projectId }
        );
        responseContent = (chatResFallback.result as any)?.message?.content || (chatResFallback.result as any)?.text || '';
        resolvedModel = chatResFallback.model || fallbackModel;
        promptTokens = chatResFallback.tokens?.prompt || estimatedTokens;
        completionTokens = chatResFallback.tokens?.completion || 50;
      } catch (fallbackError: any) {
        responseContent = `Desculpe, ocorreu um erro ao se conectar com os modelos locais (Ollama). Erro principal: ${(e as any)?.message}. Erro fallback: ${fallbackError?.message}`;
        promptTokens = estimatedTokens;
        completionTokens = 20;
      }
    }

    const msgId = `msg_${Date.now()}`;

    if (stream) {
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');

      const sendEvent = (event: string, data: any) => {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      sendEvent('message_start', { type: 'message_start', message: { id: msgId, type: 'message', role: 'assistant', content: [], model: resolvedModel, stop_reason: null, stop_sequence: null, usage: { input_tokens: promptTokens, output_tokens: 1 } } });
      sendEvent('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      sendEvent('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: responseContent } });
      sendEvent('content_block_stop', { type: 'content_block_stop', index: 0 });
      sendEvent('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: completionTokens } });
      sendEvent('message_stop', { type: 'message_stop' });
      reply.raw.end();
      return;
    }

    return reply.send({
      id: msgId,
      type: 'message',
      role: 'assistant',
      model: resolvedModel,
      content: [
        {
          type: 'text',
          text: responseContent,
        },
      ],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: promptTokens,
        output_tokens: completionTokens,
      },
    });
  });
}
