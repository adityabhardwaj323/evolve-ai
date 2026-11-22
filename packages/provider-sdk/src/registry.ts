import { ProviderType } from '@evolve-ai/shared-types';
import { IProviderAdapter } from './types.js';
import { GeminiAdapter } from './adapters/gemini.js';
import { OpenAIAdapter } from './adapters/openai.js';
import { ClaudeAdapter } from './adapters/claude.js';
import { GrokAdapter } from './adapters/grok.js';
import { MistralAdapter } from './adapters/mistral.js';
import { OpenRouterAdapter } from './adapters/openrouter.js';

export class ProviderRegistry {
  private static instance: ProviderRegistry;
  private adapters = new Map<ProviderType, IProviderAdapter>();

  private constructor() {
    this.register(new GeminiAdapter());
    this.register(new OpenAIAdapter());
    this.register(new ClaudeAdapter());
    this.register(new GrokAdapter());
    this.register(new MistralAdapter());
    this.register(new OpenRouterAdapter());
  }

  public static getInstance(): ProviderRegistry {
    if (!ProviderRegistry.instance) {
      ProviderRegistry.instance = new ProviderRegistry();
    }
    return ProviderRegistry.instance;
  }

  public register(adapter: IProviderAdapter): void {
    this.adapters.set(adapter.providerType, adapter);
  }

  public get(providerType: ProviderType): IProviderAdapter {
    const adapter = this.adapters.get(providerType);
    if (!adapter) {
      throw new Error(`Unsupported or unconfigured AI provider: "${providerType}". Supported: ${Array.from(this.adapters.keys()).join(', ')}`);
    }
    return adapter;
  }

  public listSupportedProviders() {
    return Array.from(this.adapters.values()).map((a) => a.getMetadata());
  }
}
