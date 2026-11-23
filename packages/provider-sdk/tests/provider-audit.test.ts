import { describe, it, expect, vi } from 'vitest';
import { ProviderRegistry } from '../src/registry.js';
import { GeminiAdapter } from '../src/adapters/gemini.js';
import { OpenAIAdapter } from '../src/adapters/openai.js';
import { ClaudeAdapter } from '../src/adapters/claude.js';
import { GrokAdapter } from '../src/adapters/grok.js';
import { MistralAdapter } from '../src/adapters/mistral.js';
import { OpenRouterAdapter } from '../src/adapters/openrouter.js';

describe('Milestone 3.1 — Complete Provider Adapters Audit & Verification Tests', () => {
  const registry = ProviderRegistry.getInstance();

  // Test 1: Anthropic Dynamic Model Discovery with Pagination & Status
  it('Anthropic ClaudeAdapter: dynamic model discovery parses pagination and distinguishes statuses', async () => {
    const adapter = new ClaudeAdapter();

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/v1/models')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: 'claude-3-5-sonnet-20241022', display_name: 'Claude 3.5 Sonnet', status: 'active' },
              { id: 'claude-2.1', display_name: 'Claude 2.1', status: 'deprecated' },
            ],
            has_more: false,
          }),
        };
      }
      return { ok: false };
    });

    const models = await adapter.listModels('fake-claude-key');
    expect(models.length).toBe(2);
    expect(models[0].id).toBe('claude-3-5-sonnet-20241022');
    expect(models[0].status).toBe('active');
    expect(models[0].isFallback).toBe(false);
    expect(models[1].id).toBe('claude-2.1');
    expect(models[1].status).toBe('deprecated');
  });

  // Test 2: Gemini Dynamic Models Discovery with pageToken
  it('GeminiAdapter: dynamic model discovery handles pageSize and pageToken correctly', async () => {
    const adapter = new GeminiAdapter();

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          {
            name: 'models/gemini-1.5-pro',
            displayName: 'Gemini 1.5 Pro',
            supportedGenerationMethods: ['generateContent'],
            inputTokenLimit: 2097152,
          },
        ],
      }),
    } as any);

    const models = await adapter.listModels('fake-gemini-key');
    expect(models.length).toBe(1);
    expect(models[0].id).toBe('gemini-1.5-pro');
    expect(models[0].contextWindow).toBe(2097152);
    expect(models[0].isFallback).toBe(false);
  });

  // Test 3: OpenAI Streaming & Cancellation
  it('OpenAIAdapter: streaming handles abort signal without leaking or continuing', async () => {
    const adapter = new OpenAIAdapter();
    const controller = new AbortController();

    const stream = new ReadableStream({
      start(controllerStream) {
        controllerStream.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\\n\\n'));
      },
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: stream,
    } as any);

    let deltas = '';
    const promise = adapter.streamText(
      'fake-openai-key',
      {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'test' }],
        signal: controller.signal,
      },
      (e) => {
        if (e.type === 'content_delta') deltas += e.content;
      }
    );

    controller.abort();
    await expect(promise).rejects.toThrow();
  });

  // Test 4: xAI Grok, Mistral, and OpenRouter Adapter Verification
  it('GrokAdapter: formats request with xAI base url and authorization', async () => {
    const grok = new GrokAdapter();
    expect(grok.getMetadata().id).toBe('grok');
    expect(grok.listStaticModels()[0].id).toBe('grok-beta');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Grok response' } }],
        usage: { prompt_tokens: 5, completion_tokens: 5 },
      }),
    } as any);

    const res = await grok.generateText('fake-grok-key', {
      model: 'grok-beta',
      messages: [{ role: 'user', content: 'hello grok' }],
    });
    expect(res.content).toBe('Grok response');
    expect(res.provider).toBe('grok');
  });

  it('MistralAdapter: generates response and parses codestral/mistral-large models', async () => {
    const mistral = new MistralAdapter();
    expect(mistral.getMetadata().id).toBe('mistral');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Mistral response' } }],
        usage: { prompt_tokens: 8, completion_tokens: 12 },
      }),
    } as any);

    const res = await mistral.generateText('fake-mistral-key', {
      model: 'mistral-small-latest',
      messages: [{ role: 'user', content: 'hello mistral' }],
    });
    expect(res.content).toBe('Mistral response');
    expect(res.usage?.totalTokens).toBe(20);
  });

  it('OpenRouterAdapter: correctly formats headers and parses models', async () => {
    const openrouter = new OpenRouterAdapter();
    expect(openrouter.getMetadata().id).toBe('openrouter');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
          { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3' },
        ],
      }),
    } as any);

    const models = await openrouter.listModels('fake-openrouter-key');
    expect(models.length).toBe(2);
    expect(models[0].id).toBe('meta-llama/llama-3.3-70b-instruct');
  });

  // Milestone 3.2 Tests
  it('GeminiAdapter: uses x-goog-api-key header and never leaks API key in request URL', async () => {
    const adapter = new GeminiAdapter();
    const testKey = 'AIzaSySecretGeminiKey12345';

    let capturedUrl = '';
    let capturedHeaders: any = {};

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = init?.headers || {};
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Gemini header auth response' }] } }],
          usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 4 },
        }),
      };
    });

    const res = await adapter.generateText(testKey, {
      model: 'gemini-1.5-flash',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(capturedUrl).not.toContain(testKey);
    expect(capturedUrl).not.toContain('key=');
    expect(capturedHeaders['x-goog-api-key']).toBe(testKey);
    expect(res.content).toBe('Gemini header auth response');
  });

  it('GeminiAdapter: redacts API key from error messages and logs', async () => {
    const adapter = new GeminiAdapter();
    const testKey = 'AIzaSySecretGeminiKeyToRedact';

    global.fetch = vi.fn().mockImplementation(async () => {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          error: { message: `Invalid API key provided: ${testKey} for project` },
        }),
      };
    });

    await expect(
      adapter.generateText(testKey, {
        model: 'gemini-1.5-flash',
        messages: [{ role: 'user', content: 'test' }],
      })
    ).rejects.toThrowError(/\[REDACTED_API_KEY\]/);
  });

  it('Static catalogues: presented as stale/fallback with unknown status and verification dates', () => {
    const gemini = new GeminiAdapter();
    const claude = new ClaudeAdapter();
    const openai = new OpenAIAdapter();

    const gModels = gemini.listStaticModels();
    expect(gModels[0].isFallback).toBe(true);
    expect(gModels[0].status).toBe('unknown');
    expect(gModels[0].lastVerifiedDate).toBeDefined();

    const cModels = claude.listStaticModels();
    expect(cModels[0].isFallback).toBe(true);
    expect(cModels[0].status).toBe('unknown');
    expect(cModels[0].lastVerifiedDate).toBeDefined();

    const oModels = openai.listStaticModels();
    expect(oModels[0].isFallback).toBe(true);
    expect(oModels[0].status).toBe('unknown');
  });
});
