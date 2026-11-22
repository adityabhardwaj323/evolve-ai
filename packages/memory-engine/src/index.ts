import { Memory, MemoryCategory } from '@evolve-ai/shared-types';

export interface MemoryRetrievalQuery {
  userId: string;
  projectId?: string | null;
  query: string;
  limit?: number;
  categories?: MemoryCategory[];
}

export interface MemoryCandidate {
  category: MemoryCategory;
  content: string;
  confidence: number;
  sourceText: string;
}

export function rankMemories(memories: Memory[], query: string, limit: number = 10): Memory[] {
  if (!memories.length || !query.trim()) {
    return memories.slice(0, limit);
  }

  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  if (!queryTerms.length) {
    return memories.slice(0, limit);
  }

  // Score memories based on keyword matches, status weighting, and recency
  const scored = memories.map(memory => {
    let score = 0;
    const contentLower = memory.content.toLowerCase();

    for (const term of queryTerms) {
      if (contentLower.includes(term)) {
        score += 10;
      }
    }

    // Status weighting
    if (memory.status === 'approved') score += 15;
    else if (memory.status === 'candidate') score += 5;
    else if (memory.status === 'unverified') score += 2;
    else if (memory.status === 'rejected' || memory.status === 'archived') score -= 50;

    return { memory, score };
  });

  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.memory)
    .slice(0, limit);
}
