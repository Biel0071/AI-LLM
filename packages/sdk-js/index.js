/**
 * AI Platform SDK (JavaScript puro, zero dependencias)
 * Funciona em Node 18+, browsers e apps Lovable.
 *
 *   import { AIPlatform } from '@ai-platform/sdk-js';
 *   const ai = new AIPlatform({ baseUrl: 'http://localhost:3000', apiKey: 'ap_...' });
 *   const { result } = await ai.text({ prompt: 'Descreva um tenis de corrida' });
 */
export class AIPlatformError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'AIPlatformError';
    this.code = code;
    this.status = status;
  }
}

export class AIPlatform {
  constructor({ baseUrl, apiKey, timeoutMs = 300000 }) {
    this.baseUrl = String(baseUrl).replace(/\/$/, '');
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  async #request(path, method, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.baseUrl + path, {
        method,
        headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok || data?.success === false) {
        throw new AIPlatformError(
          data?.error?.code ?? 'HTTP_ERROR',
          data?.error?.message ?? `HTTP ${res.status}`,
          res.status,
        );
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  text(params) { return this.#request('/v1/text', 'POST', params); }
  chat(params) { return this.#request('/v1/chat', 'POST', params); }
  image(params) { return this.#request('/v1/image', 'POST', params); }
  upscale(params) { return this.#request('/v1/upscale', 'POST', params); }
  vision(params) { return this.#request('/v1/vision', 'POST', params); }
  embed(params) { return this.#request('/v1/embed', 'POST', params); }
  ocr(params) { return this.#request('/v1/ocr', 'POST', params); }
  createJob(params) { return this.#request('/v1/jobs', 'POST', params); }
  getJob(jobId) { return this.#request(`/v1/jobs/${jobId}`, 'GET'); }
  models(provider) {
    const qs = provider ? `?provider=${encodeURIComponent(provider)}` : '';
    return this.#request(`/v1/models${qs}`, 'GET');
  }
  providers() { return this.#request('/v1/providers', 'GET'); }
  health() { return this.#request('/v1/health', 'GET'); }

  async waitJob(jobId, { pollMs = 2000, timeoutMs = 300000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await this.getJob(jobId);
      if (status.status === 'completed' || status.status === 'failed') return status;
      await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new AIPlatformError('TIMEOUT', `job ${jobId} did not finish in time`);
  }
}

export default AIPlatform;
