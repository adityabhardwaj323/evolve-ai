import {
  ModelDescriptor,
  ProviderCapability,
  ProviderMetadata,
  ProviderType,
  StreamEvent,
} from '@evolve-ai/shared-types';
import { IProviderAdapter, ProviderRequestOptions, ProviderResponse } from '../types.js';

export class GeminiAdapter implements IProviderAdapter {
  readonly providerType: ProviderType = 'gemini';

  getMetadata(): ProviderMetadata {
    return {
      id: 'gemini',
      name: 'Google Gemini',
      description: 'Google DeepMind state-of-the-art multimodal models.',
      website: 'https://ai.google.dev',
      docUrl: 'https://ai.google.dev/gemini-api/docs',
      defaultModel: 'gemini-1.5-flash',
      capabilities: this.getCapabilities(),
    };
  }

  getCapabilities(): ProviderCapability {
    return {
      supportsStreaming: true,
      supportsModelDiscovery: true,
      supportsSystemPrompt: true,
      supportsUsageReporting: true,
      supportsTools: true,
      supportsVision: true,
      maxContextTokens: 1048576,
    };
  }

  listStaticModels(): ModelDescriptor[] {
    return [
      {
        id: 'gemini-1.5-flash',
        name: 'Gemini 1.5 Flash',
        provider: 'gemini',
        contextWindow: 1048576,
        description: 'Fast, versatile performance across a diverse variety of multimodal tasks.',
        isDefault: true,
        isFallback: true,
        lastVerifiedDate: '2026-11-23',
        status: 'active',
      },
      {
        id: 'gemini-1.5-pro',
        name: 'Gemini 1.5 Pro',
        provider: 'gemini',
        contextWindow: 2097152,
        description: 'Mid-size multimodal model optimized for complex reasoning tasks.',
        isFallback: true,
        lastVerifiedDate: '2026-11-23',
        status: 'active',
      },
      {
        id: 'gemini-2.0-flash-exp',
        name: 'Gemini 2.0 Flash (Experimental)',
        provider: 'gemini',
        contextWindow: 1048576,
        description: 'Next-generation multimodal model with low latency and real-time streaming.',
        isFallback: true,
        lastVerifiedDate: '2026-11-23',
        status: 'active',
      },
    ];
  }

  async validateCredentials(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const errorJson = await res.json().catch(() => ({}));
        const msg = (errorJson as any)?.error?.message || `HTTP ${res.status}: Validation failed`;
        return { valid: false, error: msg };
      }
      return { valid: true };
    } catch (err: any) {
      return { valid: false, error: err.message || 'Network error reaching Gemini endpoint' };
    }
  }

  async listModels(apiKey: string): Promise<ModelDescriptor[]> {
    try {
      const allModels: ModelDescriptor[] = [];
      let pageToken: string | undefined = undefined;
      let pageCount = 0;

      while (pageCount < 5) {
        pageCount++;
        let url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=50&key=${encodeURIComponent(apiKey)}`;
        if (pageToken) {
          url += `&pageToken=${encodeURIComponent(pageToken)}`;
        }

        const res = await fetch(url);
        if (!res.ok) {
          return this.listStaticModels();
        }

        const data: any = await res.json();
        if (!data.models || !Array.isArray(data.models)) {
          break;
        }

        for (const m of data.models) {
          if (m.supportedGenerationMethods?.includes('generateContent')) {
            const rawId = m.name.replace('models/', '');
            allModels.push({
              id: rawId,
              name: m.displayName || rawId,
              provider: 'gemini',
              contextWindow: m.inputTokenLimit || 1048576,
              description: m.description,
              isDefault: rawId === 'gemini-1.5-flash',
              isFallback: false,
              lastVerifiedDate: new Date().toISOString().split('T')[0],
              status: 'active',
            });
          }
        }

        if (!data.nextPageToken) {
          break;
        }
        pageToken = data.nextPageToken;
      }

      return allModels.length > 0 ? allModels : this.listStaticModels();
    } catch {
      return this.listStaticModels();
    }
  }

  private formatContents(messages: ProviderRequestOptions['messages']) {
    return messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
  }

  async generateText(apiKey: string, options: ProviderRequestOptions): Promise<ProviderResponse> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    
    const body: any = {
      contents: this.formatContents(options.messages),
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.maxTokens ?? 2048,
      },
    };

    if (options.systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: options.systemPrompt }],
      };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!res.ok) {
      const errJson: any = await res.json().catch(() => ({}));
      throw new Error(errJson?.error?.message || `Gemini API returned status ${res.status}`);
    }

    const data: any = await res.json();
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.map((p: any) => p.text).join('') || '';

    const promptTokens = data.usageMetadata?.promptTokenCount || 0;
    const completionTokens = data.usageMetadata?.candidatesTokenCount || 0;

    return {
      content: text,
      model: options.model,
      provider: 'gemini',
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
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

    const body: any = {
      contents: this.formatContents(options.messages),
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.maxTokens ?? 2048,
      },
    };

    if (options.systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: options.systemPrompt }],
      };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!res.ok) {
      const errJson: any = await res.json().catch(() => ({}));
      throw new Error(errJson?.error?.message || `Gemini stream error: HTTP ${res.status}`);
    }

    onEvent({ type: 'message_start', model: options.model, provider: 'gemini' });

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
            const jsonStr = trimmed.substring(6).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;
            try {
              const chunk = JSON.parse(jsonStr);
              const text = chunk.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
              if (text) {
                fullContent += text;
                onEvent({ type: 'content_delta', content: text });
              }
              if (chunk.usageMetadata) {
                totalPromptTokens = chunk.usageMetadata.promptTokenCount || totalPromptTokens;
                totalCompletionTokens = chunk.usageMetadata.candidatesTokenCount || totalCompletionTokens;
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
      provider: 'gemini',
      usage,
    };
  }
}
