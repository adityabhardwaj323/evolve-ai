import { describe, it, expect, beforeEach, vi } from 'vitest';
import app from '../src/index.js';
import { generateSessionToken, hashSessionToken } from '../src/auth/sessions.js';

class MockD1Database {
  public tables: Record<string, any[]> = {
    users: [],
    sessions: [],
    provider_credentials: [],
    conversations: [],
    messages: [],
    memories: [],
    memory_access_logs: [],
    knowledge_entities: [],
    knowledge_relations: [],
    feedback: [],
    user_preferences: [],
  };

  prepare(query: string) {
    const trimmed = query.trim();
    return {
      bind: (...args: any[]) => {
        const normalized = trimmed.replace(/\s+/g, ' ');
        return {
          first: async <T = any>(): Promise<T | null> => {
            if (normalized.includes('FROM sessions s') && normalized.includes('JOIN users u')) {
              const tokenHash = args[0];
              const nowIso = args[1];
              const session = this.tables.sessions.find((s) => s.token_hash === tokenHash && s.expires_at > nowIso);
              if (!session) return null;
              const user = this.tables.users.find((u) => u.id === session.user_id);
              if (!user) return null;
              return {
                session_id: session.id,
                expires_at: session.expires_at,
                user_id: user.id,
                email: user.email,
                name: user.name,
              } as T;
            }
            if (normalized.includes('FROM memories WHERE id = ? AND user_id = ?')) {
              const [id, userId] = args;
              const mem = this.tables.memories.find((m) => m.id === id && m.user_id === userId);
              return (mem as T) || null;
            }
            if (normalized.includes('FROM knowledge_entities WHERE id = ? AND user_id = ?')) {
              const [id, userId] = args;
              const ent = this.tables.knowledge_entities.find((e) => e.id === id && e.user_id === userId);
              return (ent as T) || null;
            }
            if (normalized.includes('FROM user_preferences WHERE user_id = ?')) {
              const [userId] = args;
              const pref = this.tables.user_preferences.find((p) => p.user_id === userId);
              return (pref as T) || null;
            }
            if (normalized.includes('SELECT') && normalized.includes('COUNT(*) as total')) {
              const [userId] = args;
              const userMems = this.tables.memories.filter((m) => m.user_id === userId && m.status !== 'deleted');
              return {
                total: userMems.length,
                active_count: userMems.filter((m) => m.status === 'approved' || m.status === 'active').length,
                candidate_count: userMems.filter((m) => m.status === 'candidate').length,
                rejected_count: userMems.filter((m) => m.status === 'rejected').length,
                archived_count: userMems.filter((m) => m.status === 'archived').length,
                pinned_count: userMems.filter((m) => m.is_pinned === 1).length,
              } as T;
            }
            if (normalized.includes('COUNT(*) as count FROM memory_access_logs')) {
              return { count: this.tables.memory_access_logs.length } as T;
            }
            if (normalized.includes('COUNT(*) as count FROM feedback')) {
              return { count: this.tables.feedback.length } as T;
            }
            return null;
          },
          all: async <T = any>(): Promise<{ results: T[] }> => {
            if (normalized.includes('FROM memories WHERE user_id = ?')) {
              const userId = args[0];
              const mems = this.tables.memories.filter((m) => m.user_id === userId && m.status !== 'deleted');
              return { results: mems as T[] };
            }
            if (normalized.includes('FROM knowledge_entities WHERE user_id = ?')) {
              const userId = args[0];
              const ents = this.tables.knowledge_entities.filter((e) => e.user_id === userId);
              return { results: ents as T[] };
            }
            if (normalized.includes('FROM knowledge_relations WHERE user_id = ?')) {
              const userId = args[0];
              const rels = this.tables.knowledge_relations.filter((r) => r.user_id === userId);
              return { results: rels as T[] };
            }
            if (normalized.includes('FROM feedback WHERE user_id = ?')) {
              const userId = args[0];
              const fbs = this.tables.feedback.filter((f) => f.user_id === userId);
              return { results: fbs as T[] };
            }
            return { results: [] };
          },
          run: async () => {
            if (normalized.includes('INSERT INTO memories')) {
              let id, user_id, project_id, category, title, content, confidence, importance, source_type, source_id, source_message_id, status;
              if (normalized.includes("'correction'")) {
                // In feedback router: VALUES (?, ?, 'correction', ?, ?, 0.95, 0.8, 'feedback_correction', ?, ?, 'candidate', 'unverified', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                [id, user_id, title, content, source_id, source_message_id] = args;
                category = 'correction';
                confidence = 0.95;
                importance = 0.8;
                source_type = 'feedback_correction';
                status = 'candidate';
              } else {
                [id, user_id, project_id, category, title, content, confidence, importance, source_type, source_id, source_message_id, status] = args;
              }
              this.tables.memories.push({
                id,
                user_id,
                project_id: project_id || null,
                category,
                title,
                content,
                confidence: confidence ?? 0.8,
                importance: importance ?? 0.5,
                source_type: source_type || 'direct_entry',
                source_id: source_id || null,
                source_message_id: source_message_id || null,
                status: status || 'candidate',
                verification_status: 'unverified',
                is_pinned: 0,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              });
              return { meta: { changes: 1 } };
            }
            if (normalized.includes('UPDATE memories SET status = ?')) {
              const [status, id, userId] = args;
              const mem = this.tables.memories.find((m) => m.id === id && m.user_id === userId);
              if (mem) {
                mem.status = status;
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            }
            if (normalized.includes('UPDATE memories SET is_pinned = ?')) {
              const [pinned, id, userId] = args;
              const mem = this.tables.memories.find((m) => m.id === id && m.user_id === userId);
              if (mem) {
                mem.is_pinned = pinned;
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            }
            if (normalized.includes('DELETE FROM memories WHERE id = ? AND user_id = ?')) {
              const [id, userId] = args;
              const idx = this.tables.memories.findIndex((m) => m.id === id && m.user_id === userId);
              if (idx !== -1) {
                this.tables.memories.splice(idx, 1);
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            }
            if (normalized.includes('DELETE FROM memories WHERE user_id = ?')) {
              const [userId] = args;
              const count = this.tables.memories.filter((m) => m.user_id === userId).length;
              this.tables.memories = this.tables.memories.filter((m) => m.user_id !== userId);
              return { meta: { changes: count } };
            }
            if (normalized.includes('DELETE FROM memory_access_logs WHERE user_id = ?')) {
              this.tables.memory_access_logs = [];
              return { meta: { changes: 1 } };
            }
            if (normalized.includes('INSERT INTO knowledge_entities')) {
              const [id, user_id, project_id, name, entity_type, description] = args;
              this.tables.knowledge_entities.push({ id, user_id, project_id, name, entity_type, description });
              return { meta: { changes: 1 } };
            }
            if (normalized.includes('INSERT INTO knowledge_relations')) {
              const [id, user_id, source_entity_id, target_entity_id, relation_type] = args;
              this.tables.knowledge_relations.push({ id, user_id, source_entity_id, target_entity_id, relation_type });
              return { meta: { changes: 1 } };
            }
            if (normalized.includes('INSERT INTO feedback')) {
              const [id, user_id, message_id, conversation_id, provider_type, model, rating, feedback_type, correction_text] = args;
              this.tables.feedback.push({ id, user_id, message_id, conversation_id, provider_type, model, rating, feedback_type, correction_text });
              return { meta: { changes: 1 } };
            }
            if (normalized.includes('INSERT INTO memory_access_logs')) {
              this.tables.memory_access_logs.push({});
              return { meta: { changes: 1 } };
            }
            if (normalized.includes('UPDATE memories SET last_accessed_at = CURRENT_TIMESTAMP')) {
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 1 } };
          },
        };
      },
    };
  }
}

describe('Milestone 4 — Memory, Knowledge Graph & Feedback Integration Tests', () => {
  let mockDb: MockD1Database;
  let env: any;
  let userToken: string;
  const userId = 'user-alice-123';
  const bobUserId = 'user-bob-999';

  beforeEach(async () => {
    mockDb = new MockD1Database();
    env = {
      DB: mockDb,
      ENCRYPTION_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      SESSION_SECRET: 'session_secret_32_characters_random_string!',
      ENVIRONMENT: 'production',
      CLIENT_ORIGIN: 'http://localhost:5173',
    };

    userToken = generateSessionToken();
    const tokenHash = await hashSessionToken(userToken);
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    mockDb.tables.users.push({ id: userId, email: 'alice@example.com', name: 'Alice' });
    mockDb.tables.sessions.push({ id: 'sess-alice', user_id: userId, token_hash: tokenHash, expires_at: futureDate });
  });

  // Test 1: Memory CRUD & Lifecycle
  it('supports memory creation, approval, pinning, and retrieval lifecycle', async () => {
    // 1. Create candidate memory
    const createReq = new Request('http://localhost/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}`, Origin: 'http://localhost:5173' },
      body: JSON.stringify({ category: 'personal_preference', title: 'Python', content: 'Prefers Python over Node for scripting' }),
    });

    const createRes = await app.fetch(createReq, env);
    expect(createRes.status).toBe(201);
    const createJson: any = await createRes.json();
    expect(createJson.success).toBe(true);
    const memId = createJson.data.id;

    // 2. Approve candidate memory
    const approveReq = new Request(`http://localhost/memory/${memId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}`, Origin: 'http://localhost:5173' },
    });
    const approveRes = await app.fetch(approveReq, env);
    expect(approveRes.status).toBe(200);

    // 3. Pin memory
    const pinReq = new Request(`http://localhost/memory/${memId}/pin`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}`, Origin: 'http://localhost:5173' },
    });
    const pinRes = await app.fetch(pinReq, env);
    expect(pinRes.status).toBe(200);
    const pinJson: any = await pinRes.json();
    expect(pinJson.data.isPinned).toBe(true);

    // 4. Retrieve via hybrid search
    const retrieveReq = new Request('http://localhost/memory/retrieve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}`, Origin: 'http://localhost:5173' },
      body: JSON.stringify({ query: 'What language for scripting?' }),
    });
    const retrieveRes = await app.fetch(retrieveReq, env);
    expect(retrieveRes.status).toBe(200);
    const retrieveJson: any = await retrieveRes.json();
    expect(retrieveJson.data.relevantMemories.length).toBeGreaterThan(0);
    expect(retrieveJson.data.relevantMemories[0].id).toBe(memId);
  });

  // Test 2: Sensitive Secret Rejection
  it('strictly rejects API keys and passwords from being saved into memory', async () => {
    const leakReq = new Request('http://localhost/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}`, Origin: 'http://localhost:5173' },
      body: JSON.stringify({ category: 'personal_preference', content: 'My password is SuperSecretPassword123' }),
    });

    const leakRes = await app.fetch(leakReq, env);
    expect(leakRes.status).toBe(400);
    const leakJson: any = await leakRes.json();
    expect(leakJson.error.code).toBe('SENSITIVE_DATA_BLOCKED');
  });

  // Test 3: Knowledge Graph Entities & Relations
  it('creates entities and validates relationships under user ownership', async () => {
    // 1. Create Entity A (Person)
    const entAReq = new Request('http://localhost/knowledge-graph/entities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}`, Origin: 'http://localhost:5173' },
      body: JSON.stringify({ name: 'Alice', entityType: 'Person' }),
    });
    const entARes = await app.fetch(entAReq, env);
    expect(entARes.status).toBe(201);
    const entAJson: any = await entARes.json();

    // 2. Create Entity B (Technology)
    const entBReq = new Request('http://localhost/knowledge-graph/entities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}`, Origin: 'http://localhost:5173' },
      body: JSON.stringify({ name: 'TypeScript', entityType: 'Technology' }),
    });
    const entBRes = await app.fetch(entBReq, env);
    expect(entBRes.status).toBe(201);
    const entBJson: any = await entBRes.json();

    // 3. Create Relation: Alice -> PREFERS -> TypeScript
    const relReq = new Request('http://localhost/knowledge-graph/relations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}`, Origin: 'http://localhost:5173' },
      body: JSON.stringify({ sourceEntityId: entAJson.data.id, targetEntityId: entBJson.data.id, relationType: 'PREFERS' }),
    });
    const relRes = await app.fetch(relReq, env);
    expect(relRes.status).toBe(201);

    // 4. Retrieve Graph
    const graphReq = new Request('http://localhost/knowledge-graph', {
      headers: { Authorization: `Bearer ${userToken}`, Origin: 'http://localhost:5173' },
    });
    const graphRes = await app.fetch(graphReq, env);
    expect(graphRes.status).toBe(200);
    const graphJson: any = await graphRes.json();
    expect(graphJson.data.entities.length).toBe(2);
    expect(graphJson.data.relations.length).toBe(1);
    expect(graphJson.data.relations[0].relationType).toBe('PREFERS');
  });

  // Test 4: Feedback with Auto Candidate Correction
  it('records feedback and automatically generates candidate memory when correction text is provided', async () => {
    const fbReq = new Request('http://localhost/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}`, Origin: 'http://localhost:5173' },
      body: JSON.stringify({
        messageId: 'msg-123',
        rating: -1,
        feedbackType: 'incorrect',
        correctionText: 'Actually I use pnpm instead of npm.',
      }),
    });

    const fbRes = await app.fetch(fbReq, env);
    expect(fbRes.status).toBe(201);
    const fbJson: any = await fbRes.json();
    expect(fbJson.success).toBe(true);
    expect(fbJson.data.generatedCandidateId).toBeDefined();

    // Verify candidate was created in memories table
    const cand = mockDb.tables.memories.find((m) => m.id === fbJson.data.generatedCandidateId);
    expect(cand).toBeDefined();
    expect(cand.category).toBe('correction');
    expect(cand.status).toBe('candidate');
  });

  // Test 5: Tenant Isolation
  it('strictly isolates memories and rejects cross-tenant access', async () => {
    mockDb.tables.memories.push({
      id: 'mem-bob-secret',
      user_id: bobUserId,
      category: 'personal_preference',
      content: 'Bob secret preference',
      status: 'approved',
      is_pinned: 0,
      confidence: 0.9,
      importance: 0.8,
      source_type: 'direct_entry',
      verification_status: 'verified',
    });

    // Alice attempts to delete Bob's memory
    const delReq = new Request('http://localhost/memory/mem-bob-secret', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${userToken}`, Origin: 'http://localhost:5173' },
    });
    const delRes = await app.fetch(delReq, env);
    expect(delRes.status).toBe(404);

    // Verify Bob's record remains untouched
    expect(mockDb.tables.memories.find((m) => m.id === 'mem-bob-secret')).toBeDefined();
  });
});
