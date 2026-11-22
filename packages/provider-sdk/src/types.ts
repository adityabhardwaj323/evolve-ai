import {
  ModelDescriptor,
  ProviderCapability,
  ProviderType,
  ProviderMetadata,
  StreamEvent,
  UsageMetadata,
} from '@evolve-ai/shared-types';

export interface ProviderRequestOptions {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  signal?: AbortSignal;
}

export interface ProviderResponse {
  content: string;
  model: string;
  provider: ProviderType;
  usage?: UsageMetadata;
}

export interface IProviderAdapter {
  readonly providerType: ProviderType;
  getMetadata(): ProviderMetadata;
  getCapabilities(): ProviderCapability;
  listStaticModels(): ModelDescriptor[];
  validateCredentials(apiKey: string, customEndpoint?: string): Promise<{ valid: boolean; error?: string }>;
  listModels(apiKey: string, customEndpoint?: string): Promise<ModelDescriptor[]>;
  generateText(apiKey: string, options: ProviderRequestOptions, customEndpoint?: string): Promise<ProviderResponse>;
  streamText(
    apiKey: string,
    options: ProviderRequestOptions,
    onEvent: (event: StreamEvent) => void,
    customEndpoint?: string
  ): Promise<ProviderResponse>;
}
