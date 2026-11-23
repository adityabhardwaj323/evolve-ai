import { Memory } from '@evolve-ai/shared-types';
import { MemoryCandidate } from './types.js';

/**
 * Calculates string similarity using Jaccard token overlap
 */
export function calculateTokenSimilarity(strA: string, strB: string): number {
  const wordsA = new Set(strA.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean));
  const wordsB = new Set(strB.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean));

  if (!wordsA.size || !wordsB.size) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }

  const union = new Set([...wordsA, ...wordsB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Detects duplicates and semantic conflicts against existing memories
 */
export function deduplicateAndDetectConflicts(
  candidates: MemoryCandidate[],
  existingMemories: Memory[]
): MemoryCandidate[] {
  return candidates.map((candidate) => {
    let duplicateId: string | undefined;
    let conflictId: string | undefined;
    let action: 'create' | 'update' | 'ignore' = 'create';

    const activeExisting = existingMemories.filter(
      (m) => m.status === 'active' || m.status === 'approved' || m.status === 'candidate'
    );

    for (const existing of activeExisting) {
      const similarity = calculateTokenSimilarity(candidate.content, existing.content);

      // Duplicate match: High overlap in same category
      if (candidate.category === existing.category && similarity > 0.70) {
        duplicateId = existing.id;
        action = 'ignore';
        break;
      }

      // Conflict match: Same category, moderate keyword overlap but different details/preference
      if (candidate.category === existing.category && similarity >= 0.25 && similarity <= 0.70) {
        conflictId = existing.id;
        action = 'update';
      }
    }

    return {
      ...candidate,
      possibleDuplicateId: duplicateId,
      possibleConflictId: conflictId,
      suggestedAction: action,
    };
  });
}
