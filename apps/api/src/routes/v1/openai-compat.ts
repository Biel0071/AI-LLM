import { FastifyInstance } from 'fastify';
import { ExecutionGateway } from '../../services/execution-gateway.service';
import { ProviderStream } from '@api-platform/shared';

export async function registerOpenAICompatRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', fastify.requireApiKey);

  fastify.post('/v1/chat/completions', async (request: any, reply) => {
    const { messages, model, temperature, max_tokens, stream } = request.body || {};

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return reply.status(400).send({
        error: { message: 'Campo "messages" é obrigatório e deve ser uma lista não vazia.', type: 'invalid_request_error', param: 'messages', code: 400 },
      });
    }

    const tenantId = request.auth?.tenantId || 'default_tenant';

    try {
      const { ctx, response } = await ExecutionGateway.execute(tenantId, {
        messages,
        model,
        temperature,
        maxTokens: max_tokens,
        stream
      }, stream);

      const completionId = `chatcmpl-${Date.now()}`;
      const timestamp = Math.floor(Date.now() / 1000);

      // Metadados do gateway de observabilidade
      const gatewayTrace = {
        requestId: request.id || crypto.randomUUID(),
        executionId: ctx.executionId,
        mode: ctx.decision?.mode,
        transport: ctx.decision?.transport,
        provider: 'auto', // Seria preenchido dinamicamente se o ProviderRegistry retornar o ID
        cache: ctx.cacheHit,
        planner: ctx.plannerUsed,
        queue: ctx.queueUsed,
        // latency: ctx.metrics?.totalLatency || ctx.metrics?.latency || 0,
        cost: ctx.complexity?.estimatedCost || 0,
        metrics: ctx.metrics,
        trace: ctx.trace
      };

      if ('stream' in response && response.stream) {
        // Handle SSE Streaming (Eventos Estruturados)
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.flushHeaders();

        // 1. Envia o evento de Gateway Trace
        reply.raw.write(`event: gateway\\ndata: ${JSON.stringify(gatewayTrace)}\\n\\n`);

        // 2. Envia Status Inicial
        const statusMsg = ctx.decision?.mode === 'FAST' ? '⚡ Fast Response' : (ctx.decision?.mode === 'WORKFLOW' ? '⚙️ Executando Workflow' : '🧠 AI Thinking');
        reply.raw.write(`event: status\\ndata: ${JSON.stringify({ message: statusMsg })}\\n\\n`);

        const heartbeat = setInterval(() => {
          reply.raw.write(':ping\\n\\n');
        }, 15000);

        try {
          const streamResponse = response as ProviderStream;
          let roleSent = false;
          
          for await (const chunk of streamResponse.chunks) {
            if (chunk.type === 'status') {
              reply.raw.write(`event: status\\ndata: ${JSON.stringify({ message: chunk.message })}\\n\\n`);
              continue;
            }

            if (!roleSent) {
              const rolePayload = {
                id: completionId,
                object: 'chat.completion.chunk',
                created: timestamp,
                model: streamResponse.model,
                choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }]
              };
              reply.raw.write(`event: delta\\ndata: ${JSON.stringify(rolePayload)}\\n\\n`);
              roleSent = true;
            }

            if (chunk.type === 'delta') {
              const chunkPayload = {
                id: completionId,
                object: 'chat.completion.chunk',
                created: timestamp,
                model: streamResponse.model,
                choices: [{ 
                  index: 0, 
                  delta: { content: chunk.text }, 
                  finish_reason: chunk.finishReason || null 
                }]
              };
              reply.raw.write(`event: delta\\ndata: ${JSON.stringify(chunkPayload)}\\n\\n`);
            } else if (chunk.type === 'usage') {
              reply.raw.write(`event: usage\\ndata: ${JSON.stringify({ 
                prompt_tokens: chunk.promptTokens,
                completion_tokens: chunk.completionTokens,
                total_tokens: chunk.totalTokens
              })}\\n\\n`);
            }
          }
          
          reply.raw.write('event: done\\ndata: [DONE]\\n\\n');
        } finally {
          clearInterval(heartbeat);
          reply.raw.end();
        }
        
        return;
      } else {
        // Handle Synchronous Response
        const syncResponse = response as any;
        const content = syncResponse.result?.message?.content || syncResponse.result?.text || '';
        const resolvedModel = syncResponse.model || model || 'auto';
        
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
                content,
              },
              finish_reason: 'stop',
            },
          ],
          usage: syncResponse.tokens || {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
          },
          _gateway: gatewayTrace
        });
      }
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(err.status || 500).send({
        error: {
          message: err.message || 'Internal Server Error',
          type: 'api_error',
          code: err.status || 500
        }
      });
    }
  });
}
