import { OpenAICompatibleAdapter } from './openai-compatible.js';

export class OpenAIAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super({
      providerType: 'openai',
      name: 'OpenAI',
      description: 'Industry-standard GPT-4o and reasoning models.',
      website: 'https://openai.com',
      docUrl: 'https://platform.openai.com/docs',
      defaultModel: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      capabilities: {
        supportsStreaming: true,
        supportsModelDiscovery: true,
        supportsSystemPrompt: true,
        supportsUsageReporting: true,
        supportsTools: true,
        supportsVision: true,
        maxContextTokens: 128000,
      },
      staticModels: [
        {
          id: 'gpt-4o-mini',
          name: 'GPT-4o Mini',
          provider: 'openai',
          contextWindow: 128000,
          description: 'Fast, cost-efficient small model for everyday tasks.',
          isDefault: true,
        },
        {
          id: 'gpt-4o',
          name: 'GPT-4o',
          provider: 'openai',
          contextWindow: 128000,
          description: 'High-intelligence flagship multimodal model.',
        },
        {
          id: 'o1-mini',
          name: 'o1-mini',
          provider: 'openai',
          contextWindow: 128000,
          description: 'Faster reasoning model particularly good at math and coding.',
        },
      ],
    });
  }
}
