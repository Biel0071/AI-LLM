import client from 'prom-client';

export const registryProm = new client.Registry();
client.collectDefaultMetrics({ register: registryProm });

export const metrics = {
  requests: new client.Counter({
    name: 'ai_requests_total',
    help: 'Total de requisicoes de IA',
    labelNames: ['capability', 'provider', 'cached', 'status'] as const,
    registers: [registryProm],
  }),
  duration: new client.Histogram({
    name: 'ai_request_duration_seconds',
    help: 'Duracao das chamadas aos providers',
    labelNames: ['capability', 'provider'] as const,
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
    registers: [registryProm],
  }),
  tokens: new client.Counter({
    name: 'ai_tokens_total',
    help: 'Total de tokens consumidos',
    labelNames: ['provider'] as const,
    registers: [registryProm],
  }),
};
