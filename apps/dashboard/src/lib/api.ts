const API_BASE = import.meta.env.VITE_API_URL || '/v1';

export const fetchApi = async (endpoint: string, options?: RequestInit) => {
  const url = `${API_BASE}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }

  return response.json();
};

export const api = {
  getProviders: () => fetchApi('/admin/providers'),
  getOverview: () => fetchApi('/admin/overview'),
  getModels: () => fetchApi('/admin/models'),
  getLogs: () => fetchApi('/admin/logs'),
  getStorage: () => fetchApi('/admin/storage'),
  getCapabilities: () => fetchApi('/admin/capabilities'),
};
