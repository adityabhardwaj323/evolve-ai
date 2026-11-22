import { OpenAICompatibleAdapter } from './openai-compatible.js';

export class GrokAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super({
      providerType: 'grok',
      name: 'xAI Grok',
      description: 'xAI conversational models with real-time knowledge.',
      website: 'https://x.ai',
      docUrl: 'https://docs.x.ai',
      defaultModel: 'grok-beta',
      baseUrl: 'https://api.x.ai/v1',
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
          id: 'grok-beta',
          name: 'Grok Beta',
          provider: 'grok',
          contextWindow: 131072,
          description: 'Frontier conversational model by xAI.',
          isDefault: true,
        },
        {
          id: 'grok-2-vision-1212',
          name: 'Grok 2 Vision',
          provider: 'grok',
          contextWindow: 32768,
          description: 'Multimodal model with advanced visual understanding.',
        },
      ],
    });
  }
}
