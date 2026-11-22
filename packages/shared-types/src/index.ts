// Shared Types for EvolveAI Platform

export type ProviderType =
  | 'gemini'
  | 'openai'
  | 'claude'
  | 'grok'
  | 'mistral'
  | 'openrouter'
  | 'custom';

export interface ProviderCapability {
  supportsStreaming: boolean;
  supportsModelDiscovery: boolean;
  supportsSystemPrompt: boolean;
  supportsUsageReporting: boolean;
  maxContextTokens?: number;
}

export interface ModelDescriptor {
  id: string;
  name: string;
  provider: ProviderType;
  contextWindow?: number;
  description?: string;
  isDefault?: boolean;
}

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderCredentialPublic {
  id: string;
  providerType: ProviderType;
  label: string;
  maskedKey: string;
  defaultModel: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  userId: string;
  projectId?: string | null;
  title: string;
  providerType: ProviderType;
  model: string;
  isTemporary: boolean;
  createdAt: string;
  updatedAt: string;
}

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  id: string;
  conversationId: string;
  userId: string;
  role: MessageRole;
  content: string;
  model?: string;
  providerType?: ProviderType;
  tokenCount?: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export type MemoryCategory =
  | 'user_preference'
  | 'personal_interest'
  | 'learning_goal'
  | 'technical_knowledge'
  | 'professional_goal'
  | 'ongoing_project'
  | 'project_architecture'
  | 'important_decision'
  | 'previous_correction'
  | 'repeated_pattern'
  | 'user_approved_fact'
  | 'temporary_context';

export type MemoryStatus =
  | 'candidate'
  | 'approved'
  | 'unverified'
  | 'rejected'
  | 'archived';

export interface Memory {
  id: string;
  userId: string;
  projectId?: string | null;
  category: MemoryCategory;
  content: string;
  sourceType: 'conversation' | 'direct_entry' | 'feedback_correction';
  sourceId?: string | null;
  status: MemoryStatus;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  description?: string;
  goals?: string;
  techStack?: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeEntity {
  id: string;
  userId: string;
  projectId?: string | null;
  name: string;
  entityType: string;
  description?: string;
  createdAt: string;
}

export interface KnowledgeRelation {
  id: string;
  userId: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationType: string;
  createdAt: string;
}

export type FeedbackType =
  | 'positive'
  | 'negative'
  | 'helpful'
  | 'incorrect_information'
  | 'incomplete_response'
  | 'wrong_personalization'
  | 'custom_correction';

export interface FeedbackRecord {
  id: string;
  userId: string;
  messageId: string;
  rating: number; // 1 for thumbs up, -1 for thumbs down
  feedbackType: FeedbackType;
  correctionText?: string | null;
  status: 'received' | 'reviewed' | 'applied_to_candidate_memory';
  createdAt: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}
