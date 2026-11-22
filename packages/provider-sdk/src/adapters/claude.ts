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
      supportsModelDiscovery: false,
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
        description: 'Fast, lightweight intelligence with state-of-the-art speeds.',
        isDefault: true,
      },
      {
        id: 'claude-3-5-sonnet-20241022',
        name: 'Claude 3.5 Sonnet',
        provider: 'claude',
        contextWindow: 200000,
        description: 'Most intelligent model from Anthropic for complex coding and reasoning.',
      },
      {
        id: 'claude-3-opus-20240229',
        name: 'Claude 3 Opus',
        provider: 'claude',
        contextWindow: 200000,
        description: 'Powerful model for highly complex open-ended analysis.',
      },
    ];
  }

  async validateCredentials(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    try {
      // Send minimal test prompt (max_tokens=1) to validate API key
      const res = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
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

  async listModels(): Promise<ModelDescriptor[]> {
    // Anthropic API does not offer a public list-models endpoint; returns documented static models
    return this.listStaticModels();
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
