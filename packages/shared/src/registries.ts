export type CapabilityId = 
  | 'CHAT'
  | 'MISSION'
  | 'IMAGE'
  | 'VISION'
  | 'AUDIO'
  | 'EMBEDDING'
  | 'OCR'
  | 'TRANSLATION'
  | 'SEARCH'
  | 'MEMORY'
  | 'FILES'
  | 'CODE'
  | 'TOOLS';

export interface ICapability {
  id: CapabilityId;
  version: string;
  providerTypes: string[];
  supportsStreaming: boolean;
  supportsAsync: boolean;
  supportsRetry: boolean;
  supportsFallback: boolean;
  supportsCache: boolean;
  permissions: string[];
}

export const CAPABILITY_REGISTRY: Record<CapabilityId, ICapability> = {
  CHAT: {
    id: 'CHAT',
    version: '1.0',
    providerTypes: ['openai', 'anthropic', 'gemini', 'ollama', 'groq', 'cloudflare'],
    supportsStreaming: true,
    supportsAsync: true,
    supportsRetry: true,
    supportsFallback: true,
    supportsCache: true,
    permissions: ['capability:chat:execute'],
  },
  MISSION: {
    id: 'MISSION',
    version: '1.0',
    providerTypes: ['mission-engine'],
    supportsStreaming: true,
    supportsAsync: true,
    supportsRetry: true,
    supportsFallback: false,
    supportsCache: false,
    permissions: ['capability:mission:execute'],
  },
  IMAGE: {
    id: 'IMAGE',
    version: '1.0',
    providerTypes: ['openai', 'comfyui', 'forge', 'invokeai'],
    supportsStreaming: false,
    supportsAsync: true,
    supportsRetry: true,
    supportsFallback: true,
    supportsCache: true,
    permissions: ['capability:image:execute'],
  },
  VISION: {
    id: 'VISION',
    version: '1.0',
    providerTypes: ['openai', 'anthropic', 'gemini', 'ollama'],
    supportsStreaming: true,
    supportsAsync: true,
    supportsRetry: true,
    supportsFallback: true,
    supportsCache: true,
    permissions: ['capability:vision:execute'],
  },
  AUDIO: {
    id: 'AUDIO',
    version: '1.0',
    providerTypes: ['openai', 'gemini'],
    supportsStreaming: false,
    supportsAsync: true,
    supportsRetry: true,
    supportsFallback: true,
    supportsCache: true,
    permissions: ['capability:audio:execute'],
  },
  EMBEDDING: {
    id: 'EMBEDDING',
    version: '1.0',
    providerTypes: ['openai', 'gemini', 'ollama', 'cloudflare'],
    supportsStreaming: false,
    supportsAsync: false,
    supportsRetry: true,
    supportsFallback: true,
    supportsCache: true,
    permissions: ['capability:embedding:execute'],
  },
  OCR: {
    id: 'OCR',
    version: '1.0',
    providerTypes: ['vision', 'cloud'],
    supportsStreaming: false,
    supportsAsync: true,
    supportsRetry: true,
    supportsFallback: true,
    supportsCache: true,
    permissions: ['capability:ocr:execute'],
  },
  TRANSLATION: {
    id: 'TRANSLATION',
    version: '1.0',
    providerTypes: ['openai', 'anthropic', 'gemini', 'cloud'],
    supportsStreaming: true,
    supportsAsync: true,
    supportsRetry: true,
    supportsFallback: true,
    supportsCache: true,
    permissions: ['capability:translation:execute'],
  },
  SEARCH: {
    id: 'SEARCH',
    version: '1.0',
    providerTypes: ['custom', 'mcp'],
    supportsStreaming: false,
    supportsAsync: true,
    supportsRetry: true,
    supportsFallback: true,
    supportsCache: true,
    permissions: ['capability:search:execute'],
  },
  MEMORY: {
    id: 'MEMORY',
    version: '1.0',
    providerTypes: ['internal'],
    supportsStreaming: false,
    supportsAsync: false,
    supportsRetry: true,
    supportsFallback: false,
    supportsCache: true,
    permissions: ['capability:memory:read', 'capability:memory:write'],
  },
  FILES: {
    id: 'FILES',
    version: '1.0',
    providerTypes: ['internal', 's3'],
    supportsStreaming: false,
    supportsAsync: true,
    supportsRetry: true,
    supportsFallback: false,
    supportsCache: true,
    permissions: ['capability:files:read', 'capability:files:write'],
  },
  CODE: {
    id: 'CODE',
    version: '1.0',
    providerTypes: ['openai', 'anthropic', 'gemini', 'ollama'],
    supportsStreaming: true,
    supportsAsync: true,
    supportsRetry: true,
    supportsFallback: true,
    supportsCache: true,
    permissions: ['capability:code:execute'],
  },
  TOOLS: {
    id: 'TOOLS',
    version: '1.0',
    providerTypes: ['mcp', 'internal'],
    supportsStreaming: false,
    supportsAsync: true,
    supportsRetry: true,
    supportsFallback: true,
    supportsCache: true,
    permissions: ['capability:tools:execute'],
  }
};

export interface IModel {
  id: string;
  provider: string;
  capability: CapabilityId;
  contextWindow: number;
  streaming: boolean;
  vision: boolean;
  audio: boolean;
  functionCalling: boolean;
  pricePer1kTokens: { prompt: number; completion: number };
  latencyTier: 'low' | 'medium' | 'high';
  status: 'active' | 'deprecated' | 'offline';
}

export const MODEL_REGISTRY: IModel[] = [
  {
    id: 'gpt-4o',
    provider: 'openai',
    capability: 'CHAT',
    contextWindow: 128000,
    streaming: true,
    vision: true,
    audio: false,
    functionCalling: true,
    pricePer1kTokens: { prompt: 0.005, completion: 0.015 },
    latencyTier: 'low',
    status: 'active'
  },
  {
    id: 'gpt-4o-mini',
    provider: 'openai',
    capability: 'CHAT',
    contextWindow: 128000,
    streaming: true,
    vision: true,
    audio: false,
    functionCalling: true,
    pricePer1kTokens: { prompt: 0.00015, completion: 0.0006 },
    latencyTier: 'low',
    status: 'active'
  },
  {
    id: 'claude-3-5-sonnet',
    provider: 'anthropic',
    capability: 'CHAT',
    contextWindow: 200000,
    streaming: true,
    vision: true,
    audio: false,
    functionCalling: true,
    pricePer1kTokens: { prompt: 0.003, completion: 0.015 },
    latencyTier: 'low',
    status: 'active'
  },
  {
    id: 'gemini-1.5-pro',
    provider: 'gemini',
    capability: 'CHAT',
    contextWindow: 2000000,
    streaming: true,
    vision: true,
    audio: true,
    functionCalling: true,
    pricePer1kTokens: { prompt: 0.0035, completion: 0.0105 },
    latencyTier: 'medium',
    status: 'active'
  },
  {
    id: 'deepseek-r1:latest',
    provider: 'ollama',
    capability: 'CHAT',
    contextWindow: 32000,
    streaming: true,
    vision: false,
    audio: false,
    functionCalling: false,
    pricePer1kTokens: { prompt: 0, completion: 0 },
    latencyTier: 'high',
    status: 'active'
  }
];

export type ToolId = 
  | 'Filesystem'
  | 'Browser'
  | 'Docker'
  | 'SSH'
  | 'GitHub'
  | 'HTTP'
  | 'SQL'
  | 'Redis'
  | 'Storage'
  | 'Vision'
  | 'OCR'
  | 'Email'
  | 'Calendar'
  | 'Webhook';

export interface ITool {
  id: ToolId;
  name: string;
  description: string;
  provider: 'internal' | 'mcp';
  requiresAuth: boolean;
}

export const TOOL_REGISTRY: Record<ToolId, ITool> = {
  Filesystem: { id: 'Filesystem', name: 'File System Operations', description: 'Read and write local files', provider: 'internal', requiresAuth: false },
  Browser: { id: 'Browser', name: 'Web Browser', description: 'Navigate and interact with websites', provider: 'internal', requiresAuth: false },
  Docker: { id: 'Docker', name: 'Docker Engine', description: 'Manage containers', provider: 'internal', requiresAuth: true },
  SSH: { id: 'SSH', name: 'SSH Client', description: 'Execute remote commands', provider: 'internal', requiresAuth: true },
  GitHub: { id: 'GitHub', name: 'GitHub Integration', description: 'Manage repos and PRs', provider: 'mcp', requiresAuth: true },
  HTTP: { id: 'HTTP', name: 'HTTP Client', description: 'Make generic REST calls', provider: 'internal', requiresAuth: false },
  SQL: { id: 'SQL', name: 'SQL Database', description: 'Run SQL queries', provider: 'internal', requiresAuth: true },
  Redis: { id: 'Redis', name: 'Redis Cache', description: 'Read and write to cache', provider: 'internal', requiresAuth: true },
  Storage: { id: 'Storage', name: 'Object Storage', description: 'S3 compatible storage', provider: 'internal', requiresAuth: true },
  Vision: { id: 'Vision', name: 'Computer Vision', description: 'Analyze images', provider: 'internal', requiresAuth: false },
  OCR: { id: 'OCR', name: 'Optical Character Recognition', description: 'Extract text from images', provider: 'internal', requiresAuth: false },
  Email: { id: 'Email', name: 'Email Sender', description: 'Send emails', provider: 'internal', requiresAuth: true },
  Calendar: { id: 'Calendar', name: 'Calendar Integration', description: 'Manage events', provider: 'mcp', requiresAuth: true },
  Webhook: { id: 'Webhook', name: 'Webhook Sender', description: 'Fire outgoing webhooks', provider: 'internal', requiresAuth: false }
};
