import {
  ProviderType,
  ProviderMetadata,
  ProviderCredentialPublic,
  ModelDescriptor,
  Conversation,
  Message,
  UsageEvent,
  CompareResponse,
} from '@evolve-ai/shared-types';

const API_BASE = (import.meta as any).env?.VITE_API_URL || 'http://localhost:8787';

export async function apiRequest<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<{ success: boolean; data?: T; error?: { code: string; message: string } }> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  // Retrieve token from sessionStorage if present for Authorization header
  const token = sessionStorage.getItem('evolve_token');
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      credentials: 'include', // sends HttpOnly session cookies
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        success: false,
        error: json.error || { code: 'HTTP_ERROR', message: `Request failed with status ${res.status}` },
      };
    }
    return json;
  } catch (err: any) {
    return {
      success: false,
      error: { code: 'NETWORK_ERROR', message: err.message || 'Failed to reach API server' },
    };
  }
}

// Authentication API
export const AuthApi = {
  async register(data: { email: string; password: string; name?: string }) {
    const res = await apiRequest('/auth/register', { method: 'POST', body: JSON.stringify(data) });
    if (res.success && res.data?.token) {
      sessionStorage.setItem('evolve_token', res.data.token);
    }
    return res;
  },
  async login(data: { email: string; password: string }) {
    const res = await apiRequest('/auth/login', { method: 'POST', body: JSON.stringify(data) });
    if (res.success && res.data?.token) {
      sessionStorage.setItem('evolve_token', res.data.token);
    }
    return res;
  },
  async logout() {
    const res = await apiRequest('/auth/logout', { method: 'POST' });
    sessionStorage.removeItem('evolve_token');
    return res;
  },
  async getMe() {
    return apiRequest<{ user: { id: string; email: string; name: string } }>('/auth/me');
  },
};

// Providers & BYOK API
export const ProvidersApi = {
  async getSupported(): Promise<ProviderMetadata[]> {
    const res = await apiRequest<ProviderMetadata[]>('/providers/supported');
    return res.data || [];
  },
  async getSupportedModels(providerId: ProviderType): Promise<ModelDescriptor[]> {
    const res = await apiRequest<ModelDescriptor[]>(`/providers/supported/${providerId}/models`);
    return res.data || [];
  },
  async getCredentials(): Promise<ProviderCredentialPublic[]> {
    const res = await apiRequest<ProviderCredentialPublic[]>('/providers/credentials');
    return res.data || [];
  },
  async connectCredential(data: {
    providerType: ProviderType;
    label?: string;
    apiKey: string;
    defaultModel: string;
    customEndpoint?: string;
    isDefault?: boolean;
  }) {
    return apiRequest('/providers/credentials', { method: 'POST', body: JSON.stringify(data) });
  },
  async testCredential(id: string) {
    return apiRequest(`/providers/credentials/${id}/test`, { method: 'POST' });
  },
  async deleteCredential(id: string) {
    return apiRequest(`/providers/credentials/${id}`, { method: 'DELETE' });
  },
};

// Conversations & Messages API
export const ConversationsApi = {
  async list(): Promise<Conversation[]> {
    const res = await apiRequest<Conversation[]>('/conversations');
    return res.data || [];
  },
  async get(id: string): Promise<{ conversation: Conversation; messages: Message[] } | null> {
    const res = await apiRequest<{ conversation: Conversation; messages: Message[] }>(`/conversations/${id}`);
    return res.data || null;
  },
  async create(data: { title?: string; providerType: ProviderType; model: string }): Promise<Conversation | null> {
    const res = await apiRequest<Conversation>('/conversations', { method: 'POST', body: JSON.stringify(data) });
    return res.data || null;
  },
  async delete(id: string) {
    return apiRequest(`/conversations/${id}`, { method: 'DELETE' });
  },
};

// Chat & Generation API
export const ChatApi = {
  async generate(data: {
    conversationId?: string;
    providerType: ProviderType;
    model: string;
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    temperature?: number;
    maxTokens?: number;
  }) {
    return apiRequest('/chat/generate', { method: 'POST', body: JSON.stringify(data) });
  },

  async compare(data: {
    prompt: string;
    modelA: { providerType: ProviderType; model: string };
    modelB: { providerType: ProviderType; model: string };
  }): Promise<CompareResponse | null> {
    const res = await apiRequest<CompareResponse>('/chat/compare', { method: 'POST', body: JSON.stringify(data) });
    return res.data || null;
  },

  async stream(
    data: {
      conversationId?: string;
      providerType: ProviderType;
      model: string;
      messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
      temperature?: number;
      maxTokens?: number;
    },
    onDelta: (chunk: string) => void,
    onComplete: (fullContent: string) => void,
    onError: (err: string) => void,
    signal?: AbortSignal
  ) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const token = sessionStorage.getItem('evolve_token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    let accumulated = '';
    try {
      const res = await fetch(`${API_BASE}/chat/stream`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(data),
        signal,
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        onError(json.error?.message || `HTTP ${res.status}`);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        onError('Response body stream is not available');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.substring(6).trim();
            if (dataStr === '[DONE]') {
              onComplete(accumulated);
              return;
            }
            try {
              const event = JSON.parse(dataStr);
              if (event.type === 'content_delta' && event.content) {
                accumulated += event.content;
                onDelta(event.content);
              } else if (event.type === 'error') {
                onError(event.error || 'Stream error occurred');
              }
            } catch {
              // ignore partial json
            }
          }
        }
      }
      onComplete(accumulated);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        onComplete(accumulated);
      } else {
        onError(err.message || 'Stream connection failed');
      }
    }
  },
};

// Usage API
export const UsageApi = {
  async getStats() {
    return apiRequest<{
      summary: { totalRequests: number; totalPromptTokens: number; totalCompletionTokens: number; totalTokens: number };
      byProvider: Array<{ provider_type: ProviderType; requests: number; tokens: number }>;
      recentEvents: UsageEvent[];
    }>('/usage');
  },
};
