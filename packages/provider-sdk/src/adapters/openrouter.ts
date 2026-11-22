import { OpenAICompatibleAdapter } from './openai-compatible.js';

export class OpenRouterAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super({
      providerType: 'openrouter',
      name: 'OpenRouter',
      description: 'Unified gateway to dozens of commercial and open-weights models.',
      website: 'https://openrouter.ai',
      docUrl: 'https://openrouter.ai/docs',
      defaultModel: 'meta-llama/llama-3.3-70b-instruct',
      baseUrl: 'https://openrouter.ai/api/v1',
      capabilities: {
        supportsStreaming: true,
        supportsModelDiscovery: true,
        supportsSystemPrompt: true,
        supportsUsageReporting: true,
        supportsTools: true,
        supportsVision: true,
        maxContextTokens: 131072,
      },
      staticModels: [
        {
          id: 'meta-llama/llama-3.3-70b-instruct',
          name: 'Llama 3.3 70B Instruct',
          provider: 'openrouter',
          contextWindow: 131072,
          description: 'High performance open-weights flagship model by Meta.',
          isDefault: true,
        },
        {
          id: 'deepseek/deepseek-chat',
          name: 'DeepSeek V3',
          provider: 'openrouter',
          contextWindow: 65536,
          description: 'Strong, cost-effective reasoning and general chat model.',
        },
        {
          id: 'qwen/qwen-2.5-72b-instruct',
          name: 'Qwen 2.5 72B',
          provider: 'openrouter',
          contextWindow: 131072,
          description: 'Leader in multilingual coding and reasoning benchmarks.',
        },
      ],
    });
  }
}
