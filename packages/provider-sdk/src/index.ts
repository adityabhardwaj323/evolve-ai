import { ModelDescriptor, ProviderCapability, ProviderType } from '@evolve-ai/shared-types';

export interface ProviderRequestOptions {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface ProviderResponse {
  content: string;
  model: string;
  provider: ProviderType;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface IProviderAdapter {
  readonly providerType: ProviderType;
  getCapabilities(): ProviderCapability;
  validateCredentials(apiKey: string, customEndpoint?: string): Promise<{ valid: boolean; error?: string }>;
  listModels(apiKey: string, customEndpoint?: string): Promise<ModelDescriptor[]>;
  generateText(apiKey: string, options: ProviderRequestOptions, customEndpoint?: string): Promise<ProviderResponse>;
}
