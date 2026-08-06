import { FastifyInstance } from 'fastify';
import { ExecutionGateway } from '../../services/execution-gateway.service';
import { ProviderStream } from '@api-platform/shared';

export async function registerAnthropicCompatRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', fastify.requireApiKey);

  fastify.post('/v1/messages', async (request: any, reply) => {
    console.log('[ENTRY] Recebida requisicao POST /v1/messages (Anthropic Compat)');
    const { messages, system, model, temperature, max_tokens, stream } = request.body || {};

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return reply.status(400).send({
        type: 'error',
        error: { type: 'invalid_request_error', message: 'messages is required' },
      });
    }

    const tenantId = request.auth?.tenantId || 'default_tenant';

    const internalMessages = [...messages];
    if (system) {
      internalMessages.unshift({ role: 'system', content: system });
    }

    try {
      const { ctx, response } = await ExecutionGateway.execute(tenantId, {
        messages: internalMessages,
        system, // Opcionalmente passar separado se o Gateway der match nisso no futuro
        model,
        temperature,
        maxTokens: max_tokens,
        stream
      }, stream);

      const msgId = `msg_${Date.now()}`;

      if ('stream' in response && response.stream) {
        console.log('[STREAM] Iniciando streaming de resposta ao cliente (Anthropic Compat)');
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.flushHeaders();

        reply.raw.write(`event: message_start\ndata: ${JSON.stringify({
          type: "message_start",
          message: { id: msgId, type: "message", role: "assistant", content: [], model: model || 'auto', stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } }
        })}\n\n`);

        reply.raw.write(`event: content_block_start\ndata: ${JSON.stringify({
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" }
        })}\n\n`);

        try {
          const streamResponse = response as ProviderStream;
          let outputTokens = 0;
          
          for await (const chunk of streamResponse.chunks) {
            if (chunk.type === 'delta') {
              reply.raw.write(`event: content_block_delta\ndata: ${JSON.stringify({
                type: "content_block_delta",
                index: 0,
                delta: { type: "text_delta", text: chunk.text }
              })}\n\n`);
            } else if (chunk.type === 'usage') {
                outputTokens = chunk.completionTokens || 0;
            }
          }
          
          reply.raw.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`);
          
          reply.raw.write(`event: message_delta\ndata: ${JSON.stringify({
            type: "message_delta",
            delta: { stop_reason: "end_turn", stop_sequence: null },
            usage: { output_tokens: outputTokens }
          })}\n\n`);

          reply.raw.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
        } finally {
          reply.raw.end();
        }
        return;
      } else {
        const syncResponse = response as any;
        const content = syncResponse.result?.message?.content || syncResponse.result?.text || '';
        
        return reply.send({
          id: msgId,
          type: "message",
          role: "assistant",
          content: [
            {
              type: "text",
              text: content
            }
          ],
          model: model || 'auto',
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: {
            input_tokens: syncResponse.tokens?.prompt_tokens || 0,
            output_tokens: syncResponse.tokens?.completion_tokens || 0
          }
        });
      }
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(err.status || 500).send({
        type: 'error',
        error: {
          type: 'api_error',
          message: err.message || 'Internal Server Error'
        }
      });
    }
  });
}
