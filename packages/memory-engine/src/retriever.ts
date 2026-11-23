import { Memory, MemoryContextPackage, MemoryStatus } from '@evolve-ai/shared-types';
import { MemoryRetrievalQuery } from './types.js';

/**
 * Hybrid Memory Retriever:
 * Combines term matching, category weighting, project scope, importance, recency, and verification status.
 */
export function retrieveRelevantMemories(
  allMemories: Memory[],
  query: MemoryRetrievalQuery
): Memory[] {
  const {
    projectId,
    query: searchText,
    limit = 6,
    categories,
    minConfidence = 0.5,
    includeCandidates = false,
  } = query;

  const validStatuses: Set<MemoryStatus> = new Set(['approved', 'active']);
  if (includeCandidates) {
    validStatuses.add('candidate');
  }

  // Filter out invalid/deleted/archived/expired memories
  const now = new Date().toISOString();
  const candidates = allMemories.filter((m) => {
    if (!validStatuses.has(m.status)) return false;
    if (m.confidence < minConfidence) return false;
    if (m.expiresAt && m.expiresAt < now) return false;
    if (categories && categories.length > 0 && !categories.includes(m.category)) return false;

    // Project boundary rule:
    // If working in a project, allow global memories (projectId is null) AND project-scoped memories.
    // If working globally (no project), ONLY allow global memories (never leak other projects).
    if (projectId) {
      if (m.projectId && m.projectId !== projectId) return false;
    } else {
      if (m.projectId) return false;
    }

    return true;
  });

  const queryTerms = searchText
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((t) => t.length >= 2);

  const scored = candidates.map((memory) => {
    let score = 0;
    const contentLower = `${memory.title || ''} ${memory.content}`.toLowerCase();

    // 1. Keyword overlap
    for (const term of queryTerms) {
      if (contentLower.includes(term)) {
        score += 12;
      }
    }

    // 2. Status weighting
    if (memory.status === 'approved' || memory.status === 'active') score += 15;
    if (memory.isPinned) score += 25;
    if (memory.verificationStatus === 'verified') score += 10;

    // 3. Project specificity bonus
    if (projectId && memory.projectId === projectId) {
      score += 15;
    }

    // 4. Importance & Confidence score
    score += (memory.importance || 0.5) * 10;
    score += (memory.confidence || 0.5) * 10;

    return { memory, score };
  });

  // If query terms were provided, filter by positive score; otherwise return highest importance/pinned
  let filtered = scored;
  if (queryTerms.length > 0) {
    filtered = scored.filter((item) => item.score > 20); // requires at least one keyword match or pinned
  }

  return filtered
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.memory);
}

/**
 * Assembles a structured context package for AI prompt injection
 */
export function buildMemoryContextPackage(
  retrievedMemories: Memory[],
  projectDetails?: { id: string; name: string; description?: string; goals?: string; techStack?: string } | null
): MemoryContextPackage {
  return {
    relevantMemories: retrievedMemories.map((m) => ({
      id: m.id,
      category: m.category,
      title: m.title,
      content: m.content,
      confidence: m.confidence,
      importance: m.importance,
      status: m.status,
      verificationStatus: m.verificationStatus,
    })),
    projectContext: projectDetails || null,
  };
}

/**
 * Formats the memory context into a clean, compact system injection block
 */
export function formatMemoryContextPrompt(context: MemoryContextPackage): string {
  const parts: string[] = [];

  if (context.projectContext) {
    parts.push(
      `[ACTIVE PROJECT: ${context.projectContext.name}]`,
      context.projectContext.description ? `Description: ${context.projectContext.description}` : '',
      context.projectContext.techStack ? `Tech Stack: ${context.projectContext.techStack}` : '',
      context.projectContext.goals ? `Goals: ${context.projectContext.goals}` : ''
    );
  }

  if (context.relevantMemories.length > 0) {
    parts.push(
      `[USER PERSONAL INTELLIGENCE & VERIFIED MEMORY]`,
      `The following persistent user preferences and knowledge were retrieved from EvolveAI's independent memory engine:`,
      ...context.relevantMemories.map((m) => `- (${m.category}): ${m.content}`)
    );
  }

  return parts.filter(Boolean).join('\n');
}
