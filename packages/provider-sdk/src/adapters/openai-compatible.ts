import {
  ModelDescriptor,
  ProviderCapability,
  ProviderMetadata,
  ProviderType,
  StreamEvent,
} from '@evolve-ai/shared-types';
import { IProviderAdapter, ProviderRequestOptions, ProviderResponse } from '../types.js';

export interface OpenAICompatibleConfig {
  providerType: ProviderType;
  name: string;
  description: string;
  website: string;
  docUrl: string;
  defaultModel: string;
  baseUrl: string;
  staticModels: ModelDescriptor[];
  capabilities: ProviderCapability;
}

export class OpenAICompatibleAdapter implements IProviderAdapter {
  readonly providerType: ProviderType;
  protected config: OpenAICompatibleConfig;

  constructor(config: OpenAICompatibleConfig) {
    this.providerType = config.providerType;
    this.config = config;
  }

  getMetadata(): ProviderMetadata {
    return {
      id: this.providerType,
      name: this.config.name,
      description: this.config.description,
      website: this.config.website,
      docUrl: this.config.docUrl,
      defaultModel: this.config.defaultModel,
      capabilities: this.getCapabilities(),
    };
  }

  getCapabilities(): ProviderCapability {
    return this.config.capabilities;
  }

  listStaticModels(): ModelDescriptor[] {
    return this.config.staticModels.map((m) => ({
      ...m,
      isFallback: true,
      lastVerifiedDate: '2026-11-23',
      status: 'active',
    }));
  }

  protected getBaseUrl(customEndpoint?: string): string {
    return customEndpoint || this.config.baseUrl;
  }

  async validateCredentials(apiKey: string, customEndpoint?: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const url = `${this.getBaseUrl(customEndpoint)}/models`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
      if (!res.ok) {
        const errorJson: any = await res.json().catch(() => ({}));
        return {
          valid: false,
          error: errorJson?.error?.message || `HTTP ${res.status}: Credentials rejected`,
        };
      }
      return { valid: true };
    } catch (err: any) {
      return { valid: false, error: err.message || 'Network error reaching provider' };
    }
  }

  async listModels(apiKey: string, customEndpoint?: string): Promise<ModelDescriptor[]> {
    try {
      const url = `${this.getBaseUrl(customEndpoint)}/models`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        return this.listStaticModels();
      }
      const data: any = await res.json();
      if (!data.data || !Array.isArray(data.data)) {
        return this.listStaticModels();
      }

      return data.data.map((m: any) => ({
        id: m.id,
        name: m.name || m.id,
        provider: this.providerType,
        contextWindow: m.context_length || undefined,
        description: m.description,
        isDefault: m.id === this.config.defaultModel,
        isFallback: false,
        lastVerifiedDate: new Date().toISOString().split('T')[0],
        status: 'active',
      }));
    } catch {
      return this.listStaticModels();
    }
  }

  async generateText(
    apiKey: string,
    options: ProviderRequestOptions,
    customEndpoint?: string
  ): Promise<ProviderResponse> {
    const url = `${this.getBaseUrl(customEndpoint)}/chat/completions`;
    const messages = [];

    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push(...options.messages);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 2048,
        stream: false,
      }),
      signal: options.signal,
    });

    if (!res.ok) {
      const errJson: any = await res.json().catch(() => ({}));
      throw new Error(errJson?.error?.message || `${this.config.name} API error (HTTP ${res.status})`);
    }

    const data: any = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const promptTokens = data.usage?.prompt_tokens || 0;
    const completionTokens = data.usage?.completion_tokens || 0;

    return {
      content,
      model: options.model,
      provider: this.providerType,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
    };
  }

  async streamText(
    apiKey: string,
    options: ProviderRequestOptions,
    onEvent: (event: StreamEvent) => void,
    customEndpoint?: string
  ): Promise<ProviderResponse> {
    const url = `${this.getBaseUrl(customEndpoint)}/chat/completions`;
    const messages = [];

    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push(...options.messages);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 2048,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: options.signal,
    });

    if (!res.ok) {
      const errJson: any = await res.json().catch(() => ({}));
      throw new Error(errJson?.error?.message || `${this.config.name} stream error (HTTP ${res.status})`);
    }

    onEvent({ type: 'message_start', model: options.model, provider: this.providerType });

    let fullContent = '';
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('No readable response body available for streaming.');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        if (options.signal?.aborted) {
          throw new DOMException('Generation cancelled by user', 'AbortError');
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.substring(6).trim();
            if (!dataStr || dataStr === '[DONE]') continue;

            try {
              const chunk = JSON.parse(dataStr);
              const delta = chunk.choices?.[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
                onEvent({ type: 'content_delta', content: delta });
              }
              if (chunk.usage) {
                totalPromptTokens = chunk.usage.prompt_tokens || totalPromptTokens;
                totalCompletionTokens = chunk.usage.completion_tokens || totalCompletionTokens;
              }
            } catch {
              // Ignore partial parse
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const usage = {
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      totalTokens: totalPromptTokens + totalCompletionTokens,
    };

    onEvent({ type: 'usage', usage });
    onEvent({ type: 'message_complete', content: fullContent, usage });

    return {
      content: fullContent,
      model: options.model,
      provider: this.providerType,
      usage,
    };
  }
}
