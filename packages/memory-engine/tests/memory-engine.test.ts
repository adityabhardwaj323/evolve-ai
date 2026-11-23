import { describe, it, expect } from 'vitest';
import {
  extractDeterministicCandidates,
  parseExtractionResponse,
  containsSensitiveData,
  buildMemoryExtractionPrompt,
} from '../src/extractor.js';
import { calculateTokenSimilarity, deduplicateAndDetectConflicts } from '../src/deduplicator.js';
import { retrieveRelevantMemories, buildMemoryContextPackage, formatMemoryContextPrompt } from '../src/retriever.js';
import { MemoryLifecycle } from '../src/lifecycle.js';
import { Memory } from '@evolve-ai/shared-types';

describe('Milestone 4 — Personal Intelligence & Memory Engine Tests', () => {
  // Test 1: Sensitive Data Exclusion
  it('detects and excludes passwords, API keys, and sensitive financial secrets', () => {
    expect(containsSensitiveData('My password is SecretPass123!')).toBe(true);
    expect(containsSensitiveData('Here is my api_key: AIzaSyD-1234567890')).toBe(true);
    expect(containsSensitiveData('I prefer writing clean Python code')).toBe(false);

    const extracted = extractDeterministicCandidates('My secret password: 123456789 and I prefer Python');
    expect(extracted.length).toBe(0);
  });

  // Test 2: Deterministic Preference Extraction
  it('extracts personal preferences accurately from natural statements', () => {
    const text = 'I prefer TypeScript over JavaScript for backend services.';
    const candidates = extractDeterministicCandidates(text);

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].category).toBe('personal_preference');
    expect(candidates[0].content).toContain('Prefers TypeScript over JavaScript');
    expect(candidates[0].confidence).toBeGreaterThanOrEqual(0.8);
  });

  // Test 3: Structured Model Output Parsing with Fallback
  it('parses valid model JSON response and rejects malformed/sensitive items', () => {
    const validJson = JSON.stringify({
      candidates: [
        {
          category: 'working_preference',
          title: 'Testing Framework',
          content: 'Prefers Vitest for unit testing',
          confidence: 0.95,
          importance: 0.8,
        },
        {
          category: 'personal_preference',
          title: 'Secret leak',
          content: 'password: leakedPassword123',
        },
      ],
    });

    const parsed = parseExtractionResponse(validJson);
    expect(parsed.length).toBe(1);
    expect(parsed[0].content).toBe('Prefers Vitest for unit testing');
    expect(parsed[0].category).toBe('working_preference');
  });

  // Test 4: Deduplication and Conflict Detection
  it('flags duplicate memories and identifies potential semantic conflicts', () => {
    const existing: Memory[] = [
      {
        id: 'mem-1',
        userId: 'u1',
        category: 'personal_preference',
        content: 'Prefers Python for backend data analysis',
        confidence: 0.9,
        importance: 0.8,
        sourceType: 'conversation',
        status: 'approved',
        verificationStatus: 'verified',
        isPinned: false,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ];

    const duplicateCandidate = {
      category: 'personal_preference' as const,
      title: 'Python Preference',
      content: 'Prefers Python for backend data analysis',
      confidence: 0.9,
      importance: 0.8,
      sourceText: 'I prefer Python',
    };

    const conflictCandidate = {
      category: 'personal_preference' as const,
      title: 'Rust Preference',
      content: 'Prefers Rust for backend high throughput services',
      confidence: 0.9,
      importance: 0.8,
      sourceText: 'I prefer Rust',
    };

    const res = deduplicateAndDetectConflicts([duplicateCandidate, conflictCandidate], existing);

    expect(res[0].possibleDuplicateId).toBe('mem-1');
    expect(res[0].suggestedAction).toBe('ignore');

    expect(res[1].possibleConflictId).toBe('mem-1');
    expect(res[1].suggestedAction).toBe('update');
  });

  // Test 5: Hybrid Memory Retrieval & Project Boundary Filtering
  it('retrieves relevant memories and strictly excludes unapproved, expired, or other project memories', () => {
    const memories: Memory[] = [
      {
        id: 'm-global',
        userId: 'u1',
        projectId: null,
        category: 'personal_preference',
        title: 'Python Stack',
        content: 'Prefers Python and FastAPI',
        confidence: 0.9,
        importance: 0.9,
        sourceType: 'conversation',
        status: 'approved',
        verificationStatus: 'verified',
        isPinned: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      {
        id: 'm-proj-a',
        userId: 'u1',
        projectId: 'proj-a',
        category: 'project',
        title: 'Project A Database',
        content: 'Project A uses PostgreSQL with Prisma',
        confidence: 0.9,
        importance: 0.7,
        sourceType: 'conversation',
        status: 'approved',
        verificationStatus: 'verified',
        isPinned: false,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      {
        id: 'm-proj-b',
        userId: 'u1',
        projectId: 'proj-b',
        category: 'project',
        title: 'Project B Database',
        content: 'Project B uses SQLite D1',
        confidence: 0.9,
        importance: 0.7,
        sourceType: 'conversation',
        status: 'approved',
        verificationStatus: 'verified',
        isPinned: false,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      {
        id: 'm-expired',
        userId: 'u1',
        projectId: null,
        category: 'temporary_context',
        content: 'Working late tonight',
        confidence: 0.9,
        importance: 0.2,
        sourceType: 'conversation',
        status: 'approved',
        verificationStatus: 'unverified',
        isPinned: false,
        expiresAt: '2020-01-01T00:00:00Z',
        createdAt: '2020-01-01',
        updatedAt: '2020-01-01',
      },
    ];

    // Query from project A: Should get global + Project A, NOT Project B or Expired
    const retrieved = retrieveRelevantMemories(memories, {
      userId: 'u1',
      projectId: 'proj-a',
      query: 'What database and language should I use?',
    });

    const ids = retrieved.map((m) => m.id);
    expect(ids).toContain('m-global');
    expect(ids).toContain('m-proj-a');
    expect(ids).not.toContain('m-proj-b');
    expect(ids).not.toContain('m-expired');
  });

  // Test 6: Memory Lifecycle State Machine
  it('enforces memory lifecycle transitions and rejects invalid state changes', () => {
    const candidate: Memory = {
      id: 'm-lc',
      userId: 'u1',
      category: 'personal_preference',
      content: 'Prefers dark mode UI',
      confidence: 0.8,
      importance: 0.5,
      sourceType: 'conversation',
      status: 'candidate',
      verificationStatus: 'unverified',
      isPinned: false,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    };

    const approved = MemoryLifecycle.approve(candidate);
    expect(approved.status).toBe('approved');

    const archived = MemoryLifecycle.archive(approved);
    expect(archived.status).toBe('archived');

    const restored = MemoryLifecycle.restore(archived);
    expect(restored.status).toBe('approved');

    // Invalid transition: Rejected directly to active without approval
    expect(MemoryLifecycle.canTransition('rejected', 'active')).toBe(false);
  });
});
