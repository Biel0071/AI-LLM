import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';

export interface ProviderForm {
  name: string;
  enabled: boolean;
  baseUrl?: string;
  apiKey?: string;
  accountId?: string;
  defaultModel?: string;
  embedModel?: string;
}

type StoredSettings = Omit<ProviderForm, 'name' | 'enabled' | 'apiKey'> & { apiKeyEncrypted?: string };
const key = createHash('sha256').update(env.JWT_SECRET).digest();

function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
}

function decrypt(value?: string): string | undefined {
  if (!value) return undefined;
  const [iv, tag, data] = value.split('.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

export async function saveProviderConfig(form: ProviderForm): Promise<void> {
  const current = await prisma.providerConfig.findUnique({ where: { name: form.name } });
  const old = (current?.settings ?? {}) as StoredSettings;
  const settings: StoredSettings = {
    baseUrl: form.baseUrl || undefined,
    accountId: form.accountId || undefined,
    defaultModel: form.defaultModel || undefined,
    embedModel: form.embedModel || undefined,
    apiKeyEncrypted: form.apiKey ? encrypt(form.apiKey) : old.apiKeyEncrypted,
  };
  await prisma.providerConfig.upsert({
    where: { name: form.name },
    create: { name: form.name, enabled: form.enabled, baseUrl: form.baseUrl, settings: settings as object },
    update: { enabled: form.enabled, baseUrl: form.baseUrl, settings: settings as object },
  });
}

export async function listProviderConfigs() {
  const rows = await prisma.providerConfig.findMany({ orderBy: { name: 'asc' } });
  return rows.map((row) => {
    const settings = (row.settings ?? {}) as StoredSettings;
    return { ...row, settings: { ...settings, apiKeyEncrypted: undefined }, hasApiKey: Boolean(settings.apiKeyEncrypted) };
  });
}

export async function buildProviderEnv(): Promise<Record<string, string | undefined>> {
  const result: Record<string, string | undefined> = { ...process.env };
  const rows = await prisma.providerConfig.findMany({ where: { enabled: true } });
  for (const row of rows) {
    const s = (row.settings ?? {}) as StoredSettings;
    const secret = decrypt(s.apiKeyEncrypted);
    const prefix = row.name.toUpperCase();
    if (row.name === 'cloudflare') {
      result.CLOUDFLARE_ACCOUNT_ID = s.accountId;
      result.CLOUDFLARE_API_TOKEN = secret;
      result.CLOUDFLARE_BASE_URL = s.baseUrl;
      result.CLOUDFLARE_DEFAULT_MODEL = s.defaultModel;
      result.CLOUDFLARE_EMBED_MODEL = s.embedModel;
    } else if (row.name === 'ollama' || row.name === 'lmstudio' || row.name === 'comfyui' || row.name === 'forge' || row.name === 'invokeai') {
      result[`${prefix}_BASE_URL`] = s.baseUrl;
      result[`${prefix}_DEFAULT_MODEL`] = s.defaultModel;
    } else {
      result[`${prefix}_API_KEY`] = secret;
      result[`${prefix}_BASE_URL`] = s.baseUrl;
      result[`${prefix}_DEFAULT_MODEL`] = s.defaultModel;
    }
  }
  return result;
}