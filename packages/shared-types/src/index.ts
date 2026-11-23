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
  supportsTools?: boolean;
  supportsVision?: boolean;
  maxContextTokens?: number;
}

export interface ModelDescriptor {
  id: string;
  name: string;
  provider: ProviderType;
  contextWindow?: number;
  description?: string;
  isDefault?: boolean;
  capabilities?: ProviderCapability;
  isFallback?: boolean;
  lastVerifiedDate?: string;
  status?: 'active' | 'deprecated' | 'retired' | 'unknown';
}

export interface ProviderMetadata {
  id: ProviderType;
  name: string;
  description: string;
  website: string;
  docUrl: string;
  defaultModel: string;
  capabilities: ProviderCapability;
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

export interface UsageMetadata {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
}

export interface UsageEvent {
  id: string;
  userId: string;
  conversationId?: string | null;
  providerType: ProviderType;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  success: boolean;
  createdAt: string;
}

export type StreamEventType =
  | 'message_start'
  | 'content_delta'
  | 'reasoning_delta'
  | 'usage'
  | 'message_complete'
  | 'error';

export interface StreamEvent {
  type: StreamEventType;
  content?: string;
  model?: string;
  provider?: ProviderType;
  usage?: UsageMetadata;
  error?: string;
}

export interface CompareRequest {
  prompt: string;
  modelA: {
    providerType: ProviderType;
    model: string;
    credentialId?: string;
  };
  modelB: {
    providerType: ProviderType;
    model: string;
    credentialId?: string;
  };
}

export interface CompareResponse {
  prompt: string;
  responseA: {
    providerType: ProviderType;
    model: string;
    content: string;
    usage?: UsageMetadata;
    error?: string;
    latencyMs: number;
  };
  responseB: {
    providerType: ProviderType;
    model: string;
    content: string;
    usage?: UsageMetadata;
    error?: string;
    latencyMs: number;
  };
}

export type MemoryCategory =
  | 'personal_preference'
  | 'interest'
  | 'goal_ambition'
  | 'skill_knowledge'
  | 'project'
  | 'decision'
  | 'verified_fact'
  | 'correction'
  | 'working_preference'
  | 'temporary_context';

export type MemoryStatus =
  | 'candidate'
  | 'approved'
  | 'active'
  | 'updated'
  | 'unverified'
  | 'rejected'
  | 'expired'
  | 'archived'
  | 'deleted';

export type VerificationStatus = 'verified' | 'unverified';

export interface Memory {
  id: string;
  userId: string;
  projectId?: string | null;
  category: MemoryCategory;
  title?: string;
  content: string;
  confidence: number;
  importance: number;
  sourceType: 'conversation' | 'direct_entry' | 'feedback_correction';
  sourceId?: string | null; // conversationId
  sourceMessageId?: string | null;
  status: MemoryStatus;
  verificationStatus: VerificationStatus;
  isPinned: boolean;
  expiresAt?: string | null;
  lastAccessedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryContextPackage {
  relevantMemories: Array<{
    id: string;
    category: MemoryCategory;
    title?: string;
    content: string;
    confidence: number;
    importance: number;
    status: MemoryStatus;
    verificationStatus: VerificationStatus;
  }>;
  projectContext?: {
    id: string;
    name: string;
    description?: string;
    goals?: string;
    techStack?: string;
  } | null;
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
  entityType: 'Person' | 'Project' | 'Technology' | 'Goal' | 'Organization' | 'Skill' | 'Concept' | 'Decision';
  description?: string;
  createdAt: string;
}

export interface KnowledgeRelation {
  id: string;
  userId: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationType:
    | 'WORKS_ON'
    | 'USES'
    | 'PREFERS'
    | 'LEARNED'
    | 'DEPENDS_ON'
    | 'RELATED_TO'
    | 'DECIDED'
    | 'PURSUES';
  createdAt: string;
}

export type FeedbackType =
  | 'helpful'
  | 'not_helpful'
  | 'incorrect'
  | 'incomplete'
  | 'outdated'
  | 'poor_personalization'
  | 'missing_context';

export interface FeedbackRecord {
  id: string;
  userId: string;
  conversationId?: string | null;
  messageId: string;
  providerType?: ProviderType;
  model?: string;
  rating: number; // 1 for thumbs up, -1 for thumbs down
  feedbackType: FeedbackType;
  correctionText?: string | null;
  memoryIds?: string[];
  status: 'received' | 'reviewed' | 'applied_to_candidate_memory';
  createdAt: string;
}

export interface EvolutionMetrics {
  totalMemories: number;
  activeMemories: number;
  candidateMemories: number;
  approvedMemories: number;
  rejectedMemories: number;
  archivedMemories: number;
  duplicatesDetected: number;
  conflictsDetected: number;
  totalRetrievals: number;
  totalCorrections: number;
  relevanceFeedbackRate?: number;
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
