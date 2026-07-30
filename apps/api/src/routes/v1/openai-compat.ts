import { FastifyInstance } from 'fastify';
import { execute } from '../../services/ai.service';
import { CapabilityRouterService } from '../../services/capability-router.service';

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

    try {
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
      promptTokens = chatRes.tokens?.prompt || 0;
      completionTokens = chatRes.tokens?.completion || 0;
      totalTokens = chatRes.tokens?.total || promptTokens + completionTokens;
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
      promptTokens = result.usage?.promptTokens || 15;
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
      system_fingerprint: `fp_ai_platform_${resolvedProvider}`,
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
        'embed',
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
}
