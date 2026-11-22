import { describe, it, expect, vi } from 'vitest';
import { ProviderRegistry } from '../src/registry.js';
import { GeminiAdapter } from '../src/adapters/gemini.js';
import { OpenAIAdapter } from '../src/adapters/openai.js';
import { ClaudeAdapter } from '../src/adapters/claude.js';
import { GrokAdapter } from '../src/adapters/grok.js';
import { MistralAdapter } from '../src/adapters/mistral.js';
import { OpenRouterAdapter } from '../src/adapters/openrouter.js';

describe('Milestone 3 — Provider SDK & Adapters Unit Tests', () => {
  const registry = ProviderRegistry.getInstance();

  it('registers and resolves all 6 supported AI providers', () => {
    const supported = registry.listSupportedProviders();
    expect(supported.length).toBe(6);

    const ids = supported.map((s) => s.id);
    expect(ids).toContain('gemini');
    expect(ids).toContain('openai');
    expect(ids).toContain('claude');
    expect(ids).toContain('grok');
    expect(ids).toContain('mistral');
    expect(ids).toContain('openrouter');
  });

  it('rejects unknown provider requests with helpful error', () => {
    expect(() => registry.get('unknown-provider' as any)).toThrow(/Unsupported or unconfigured AI provider/);
  });

  it('detects and exposes provider capabilities accurately', () => {
    const gemini = registry.get('gemini');
    expect(gemini.getCapabilities().supportsStreaming).toBe(true);
    expect(gemini.getCapabilities().supportsModelDiscovery).toBe(true);

    const claude = registry.get('claude');
    expect(claude.getCapabilities().supportsStreaming).toBe(true);
    expect(claude.getCapabilities().supportsModelDiscovery).toBe(true); // Anthropic models discovery now supported via /v1/models
  });

  it('mock test: Gemini generation parses contents and usage correctly', async () => {
    const adapter = new GeminiAdapter();

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Hello from mock Gemini!' }] } }],
        usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 25 },
      }),
    } as any);

    const res = await adapter.generateText('fake-key', {
      model: 'gemini-1.5-flash',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(res.content).toBe('Hello from mock Gemini!');
    expect(res.provider).toBe('gemini');
    expect(res.usage?.totalTokens).toBe(40);
  });

  it('mock test: OpenAI generation parses response and usage correctly', async () => {
    const adapter = new OpenAIAdapter();

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Hello from mock OpenAI!' } }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }),
    } as any);

    const res = await adapter.generateText('fake-key', {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(res.content).toBe('Hello from mock OpenAI!');
    expect(res.provider).toBe('openai');
    expect(res.usage?.totalTokens).toBe(30);
  });

  it('mock test: Claude generation parses response and usage correctly', async () => {
    const adapter = new ClaudeAdapter();

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ text: 'Hello from mock Claude!' }],
        usage: { input_tokens: 12, output_tokens: 18 },
      }),
    } as any);

    const res = await adapter.generateText('fake-key', {
      model: 'claude-3-5-haiku-20241022',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(res.content).toBe('Hello from mock Claude!');
    expect(res.provider).toBe('claude');
    expect(res.usage?.totalTokens).toBe(30);
  });
});
