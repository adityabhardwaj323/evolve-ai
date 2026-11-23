import {
  ModelDescriptor,
  ProviderCapability,
  ProviderMetadata,
  ProviderType,
  StreamEvent,
} from '@evolve-ai/shared-types';
import { IProviderAdapter, ProviderRequestOptions, ProviderResponse } from '../types.js';

export class ClaudeAdapter implements IProviderAdapter {
  readonly providerType: ProviderType = 'claude';
  private readonly baseUrl = 'https://api.anthropic.com/v1';

  getMetadata(): ProviderMetadata {
    return {
      id: 'claude',
      name: 'Anthropic Claude',
      description: 'Claude 3.5 Sonnet and Haiku models known for thoughtful, nuanced reasoning.',
      website: 'https://anthropic.com',
      docUrl: 'https://docs.anthropic.com',
      defaultModel: 'claude-3-5-haiku-20241022',
      capabilities: this.getCapabilities(),
    };
  }

  getCapabilities(): ProviderCapability {
    return {
      supportsStreaming: true,
      supportsModelDiscovery: true, // Now supported via GET /v1/models
      supportsSystemPrompt: true,
      supportsUsageReporting: true,
      supportsTools: true,
      supportsVision: true,
      maxContextTokens: 200000,
    };
  }

  listStaticModels(): ModelDescriptor[] {
    return [
      {
        id: 'claude-3-5-haiku-20241022',
        name: 'Claude 3.5 Haiku',
        provider: 'claude',
        contextWindow: 200000,
        description: 'Fast, lightweight intelligence with state-of-the-art speeds (Static fallback catalogue - access requires active user account tier).',
        isDefault: true,
        isFallback: true,
        lastVerifiedDate: '2024-11-01',
        status: 'unknown',
      },
      {
        id: 'claude-3-5-sonnet-20241022',
        name: 'Claude 3.5 Sonnet',
        provider: 'claude',
        contextWindow: 200000,
        description: 'Anthropic model for complex coding and reasoning (Static fallback catalogue - access requires active user account tier).',
        isFallback: true,
        lastVerifiedDate: '2024-11-01',
        status: 'unknown',
      },
      {
        id: 'claude-3-opus-20240229',
        name: 'Claude 3 Opus',
        provider: 'claude',
        contextWindow: 200000,
        description: 'High-capability model for complex open-ended analysis (Static fallback catalogue - access requires active user account tier).',
        isFallback: true,
        lastVerifiedDate: '2024-03-01',
        status: 'unknown',
      },
    ];
  }

  async validateCredentials(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    try {
      // Validate by querying Anthropic /v1/models endpoint
      const res = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      });

      if (!res.ok) {
        const errJson: any = await res.json().catch(() => ({}));
        return {
          valid: false,
          error: errJson?.error?.message || `HTTP ${res.status}: Validation rejected`,
        };
      }
      return { valid: true };
    } catch (err: any) {
      return { valid: false, error: err.message || 'Network error reaching Anthropic API' };
    }
  }

  /**
   * Retrieves active, deprecated, or retired models using Anthropic's official GET /v1/models API with pagination.
   */
  async listModels(apiKey: string): Promise<ModelDescriptor[]> {
    try {
      const allModels: ModelDescriptor[] = [];
      let afterId: string | undefined = undefined;
      let hasMore = true;
      let pageCount = 0;

      while (hasMore && pageCount < 5) {
        pageCount++;
        const url = new URL(`${this.baseUrl}/models`);
        url.searchParams.set('limit', '50');
        if (afterId) {
          url.searchParams.set('after_id', afterId);
        }

        const res = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
        });

        if (!res.ok) {
          return this.listStaticModels();
        }

        const data: any = await res.json();
        if (!data.data || !Array.isArray(data.data)) {
          break;
        }

        for (const item of data.data) {
          const modelId: string = item.id;
          let status: 'active' | 'deprecated' | 'retired' = 'active';
          if (item.status === 'deprecated' || item.deprecated_at) {
            status = 'deprecated';
          } else if (item.status === 'retired') {
            status = 'retired';
          }

          allModels.push({
            id: modelId,
            name: item.display_name || modelId,
            provider: 'claude',
            contextWindow: 200000,
            description: item.type ? `Anthropic ${item.type} model` : undefined,
            isDefault: modelId === 'claude-3-5-haiku-20241022',
            isFallback: false,
            lastVerifiedDate: new Date().toISOString().split('T')[0],
            status,
          });
        }

        hasMore = Boolean(data.has_more);
        afterId = data.last_id || (data.data.length > 0 ? data.data[data.data.length - 1].id : undefined);
      }

      return allModels.length > 0 ? allModels : this.listStaticModels();
    } catch {
      return this.listStaticModels();
    }
  }

  async generateText(apiKey: string, options: ProviderRequestOptions): Promise<ProviderResponse> {
    const formattedMessages = options.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const body: any = {
      model: options.model,
      max_tokens: options.maxTokens ?? 2048,
      temperature: options.temperature ?? 0.7,
      messages: formattedMessages,
    };

    if (options.systemPrompt) {
      body.system = options.systemPrompt;
    }

    const res = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!res.ok) {
      const errJson: any = await res.json().catch(() => ({}));
      throw new Error(errJson?.error?.message || `Anthropic API error: HTTP ${res.status}`);
    }

    const data: any = await res.json();
    const content = data.content?.map((b: any) => b.text || '').join('') || '';
    const promptTokens = data.usage?.input_tokens || 0;
    const completionTokens = data.usage?.output_tokens || 0;

    return {
      content,
      model: options.model,
      provider: 'claude',
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
    onEvent: (event: StreamEvent) => void
  ): Promise<ProviderResponse> {
    const formattedMessages = options.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const body: any = {
      model: options.model,
      max_tokens: options.maxTokens ?? 2048,
      temperature: options.temperature ?? 0.7,
      messages: formattedMessages,
      stream: true,
    };

    if (options.systemPrompt) {
      body.system = options.systemPrompt;
    }

    const res = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!res.ok) {
      const errJson: any = await res.json().catch(() => ({}));
      throw new Error(errJson?.error?.message || `Anthropic stream error: HTTP ${res.status}`);
    }

    onEvent({ type: 'message_start', model: options.model, provider: 'claude' });

    let fullContent = '';
    let promptTokens = 0;
    let completionTokens = 0;

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
            if (!dataStr) continue;

            try {
              const eventData = JSON.parse(dataStr);
              if (eventData.type === 'message_start' && eventData.message?.usage) {
                promptTokens = eventData.message.usage.input_tokens || promptTokens;
              } else if (eventData.type === 'content_block_delta' && eventData.delta?.text) {
                fullContent += eventData.delta.text;
                onEvent({ type: 'content_delta', content: eventData.delta.text });
              } else if (eventData.type === 'message_delta' && eventData.usage) {
                completionTokens = eventData.usage.output_tokens || completionTokens;
              }
            } catch {
              // Ignore partial parse
            }
          }
        }
      }
    } finally {
      try {
        if (options.signal?.aborted) {
          await reader.cancel('Stream aborted');
        }
      } catch {
        // ignore cancellation error
      }
      reader.releaseLock();
    }

    const usage = {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };

    onEvent({ type: 'usage', usage });
    onEvent({ type: 'message_complete', content: fullContent, usage });

    return {
      content: fullContent,
      model: options.model,
      provider: 'claude',
      usage,
    };
  }
}
