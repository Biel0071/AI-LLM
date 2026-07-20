import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
  ADMIN_EMAIL: z.string().email().default('admin@aiplatform.local'),
  ADMIN_PASSWORD: z.string().min(6).default('admin123'),
  DEFAULT_API_KEY: z.string().optional(),

  CORS_ORIGINS: z.string().default('http://localhost:8080,http://127.0.0.1:8080'),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(50 * 1024 * 1024),

  RATE_LIMIT_MAX: z.coerce.number().default(120),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),

  CACHE_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v !== 'false'),
  CACHE_TTL_SECONDS: z.coerce.number().default(86_400),

  METRICS_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v !== 'false'),

  QUEUE_PREFIX: z.string().default('aiplatform'),
  JOB_WAIT_TIMEOUT_MS: z.coerce.number().default(180_000),
  WORKER_CONCURRENCY: z.coerce.number().default(4),
  SYNC_TEXT_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
  BATCH_MAX_JOBS: z.coerce.number().int().min(1).max(10_000).default(10_000),
  BATCH_ENQUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(25),
  REVERSE_POLL_ENABLED: z.string().default('true').transform((value) => value !== 'false'),
  REVERSE_POLL_TICK_MS: z.coerce.number().int().min(1_000).default(5_000),
  REVERSE_POLL_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  REVERSE_MAX_INFLIGHT: z.coerce.number().int().min(1).max(10_000).default(1_000),
  REVERSE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
  REVERSE_MAX_RESPONSE_BYTES: z.coerce.number().int().min(1_024).max(10_000_000).default(2_000_000),
  REVERSE_ALLOW_HTTP: z.string().default('false').transform((value) => value === 'true'),
  REVERSE_REQUIRE_RESPONSE_SIGNATURE: z.string().default('false').transform((value) => value === 'true'),
  OCR_ENGINE: z.enum(['vision', 'tesseract']).default('vision'),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(): AppEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
