import { OpenAICompatibleAdapter } from './openai-compatible.js';

export class MistralAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super({
      providerType: 'mistral',
      name: 'Mistral AI',
      description: 'Open and efficient frontier models from Mistral.',
      website: 'https://mistral.ai',
      docUrl: 'https://docs.mistral.ai',
      defaultModel: 'mistral-small-latest',
      baseUrl: 'https://api.mistral.ai/v1',
      capabilities: {
        supportsStreaming: true,
        supportsModelDiscovery: true,
        supportsSystemPrompt: true,
        supportsUsageReporting: true,
        supportsTools: true,
        supportsVision: false,
        maxContextTokens: 128000,
      },
      staticModels: [
        {
          id: 'mistral-small-latest',
          name: 'Mistral Small',
          provider: 'mistral',
          contextWindow: 128000,
          description: 'Cost-effective and low-latency model for common tasks.',
          isDefault: true,
        },
        {
          id: 'mistral-large-latest',
          name: 'Mistral Large',
          provider: 'mistral',
          contextWindow: 128000,
          description: 'Top-tier flagship reasoning model.',
        },
        {
          id: 'codestral-latest',
          name: 'Codestral',
          provider: 'mistral',
          contextWindow: 256000,
          description: 'State-of-the-art coding and software engineering specialist.',
        },
      ],
    });
  }
}
