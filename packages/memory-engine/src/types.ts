import { Memory, MemoryCategory, MemoryStatus, VerificationStatus } from '@evolve-ai/shared-types';

export interface MemoryCandidate {
  category: MemoryCategory;
  title: string;
  content: string;
  confidence: number;
  importance: number;
  sourceText: string;
  possibleDuplicateId?: string;
  possibleConflictId?: string;
  suggestedAction?: 'create' | 'update' | 'ignore';
}

export interface MemoryRetrievalQuery {
  userId: string;
  projectId?: string | null;
  query: string;
  limit?: number;
  categories?: MemoryCategory[];
  minConfidence?: number;
  includeCandidates?: boolean;
}

export interface MemoryStoreInterface {
  findActiveByUserId(userId: string, projectId?: string | null): Promise<Memory[]>;
  findById(id: string, userId: string): Promise<Memory | null>;
  create(memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>): Promise<Memory>;
  update(id: string, userId: string, patch: Partial<Memory>): Promise<Memory | null>;
}
