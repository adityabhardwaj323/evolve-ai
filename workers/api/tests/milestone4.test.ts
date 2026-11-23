import { describe, it, expect, beforeEach, vi } from 'vitest';
import app from '../src/index.js';
import { generateSessionToken, hashSessionToken } from '../src/auth/sessions.js';

class MockD1Database {
  public tables: Record<string, any[]> = {
    users: [],
    sessions: [],
    provider_credentials: [],
    projects: [],
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
            if (normalized.includes('FROM projects WHERE id = ? AND user_id = ?')) {
              const [id, userId] = args;
              const proj = this.tables.projects.find((p) => p.id === id && p.user_id === userId);
              return (proj as T) || null;
            }
            if (normalized.includes('FROM conversations WHERE id = ? AND user_id = ?')) {
              const [id, userId] = args;
              const conv = this.tables.conversations.find((c) => c.id === id && c.user_id === userId);
              return (conv as T) || null;
            }
            if (normalized.includes('FROM messages WHERE id = ? AND user_id = ?')) {
              const [id, userId] = args;
              const msg = this.tables.messages.find((m) => m.id === id && m.user_id === userId);
              return (msg as T) || null;
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
            if (normalized.includes('FROM messages WHERE conversation_id = ? AND user_id = ?')) {
              const [convId, userId] = args;
              const msgs = this.tables.messages.filter((m) => m.conversation_id === convId && m.user_id === userId);
              return { results: msgs as T[] };
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
            if (normalized.includes('UPDATE memories SET title = COALESCE')) {
              const [title, content, category, importance, verificationStatus, projectId, id, userId] = args;
              const mem = this.tables.memories.find((m) => m.id === id && m.user_id === userId);
              if (mem) {
                if (title !== null) mem.title = title;
                if (content !== null) mem.content = content;
                if (category !== null) mem.category = category;
                if (importance !== null) mem.importance = importance;
                if (verificationStatus !== null) mem.verification_status = verificationStatus;
                if (projectId !== null) mem.project_id = projectId;
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
            if (normalized.includes('DELETE FROM memory_access_logs WHERE memory_id = ? AND user_id = ?')) {
              const [memId, userId] = args;
              this.tables.memory_access_logs = this.tables.memory_access_logs.filter((l) => !(l.memory_id === memId && l.user_id === userId));
              return { meta: { changes: 1 } };
            }
            if (normalized.includes('DELETE FROM knowledge_entities WHERE user_id = ? AND entity_type = "memory"')) {
              this.tables.knowledge_entities = this.tables.knowledge_entities.filter((e) => !(e.user_id === args[0] && e.entity_type === 'memory'));
              return { meta: { changes: 1 } };
            }
            if (normalized.includes('UPDATE feedback SET memory_ids_json = NULL WHERE user_id = ?')) {
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

describe('Milestone 4 & 4.1 — Security Hardening, Project Ownership & Memory Lifecycle Tests', () => {
  let mockDb: MockD1Database;
  let env: any;
  const testUserId = 'user-alice-123';
  const bobUserId = 'user-bob-456';
  const userToken = generateSessionToken();
  const aliceProjectId = 'proj-alice-1';
  const bobProjectId = 'proj-bob-secret';

  beforeEach(async () => {
    mockDb = new MockD1Database();

    mockDb.tables.users.push(
      { id: testUserId, email: 'alice@example.com', name: 'Alice', is_active: 1 },
      { id: bobUserId, email: 'bob@example.com', name: 'Bob', is_active: 1 }
    );

    mockDb.tables.projects.push(
      { id: aliceProjectId, user_id: testUserId, name: 'Alice Project' },
      { id: bobProjectId, user_id: bobUserId, name: 'Bob Project' }
    );

    mockDb.tables.conversations.push(
      { id: 'conv-alice-1', user_id: testUserId, title: 'Alice Chat' },
      { id: 'conv-bob-1', user_id: bobUserId, title: 'Bob Chat' }
    );

    mockDb.tables.messages.push(
      { id: 'msg-alice-1', user_id: testUserId, conversation_id: 'conv-alice-1', role: 'assistant', content: 'Here is your solution.' },
      { id: 'msg-bob-1', user_id: bobUserId, conversation_id: 'conv-bob-1', role: 'assistant', content: 'Secret Bob answer.' }
    );

    const tokenHash = await hashSessionToken(userToken);
    mockDb.tables.sessions.push({
      id: 'session-alice',
      user_id: testUserId,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });

    mockDb.tables.user_preferences.push({
      user_id: testUserId,
      auto_memory_extract: 1,
      auto_memory_approval: 0,
    });

    env = {
      DB: mockDb,
      ENCRYPTION_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    };
  });

  // 1. Approval Bypass Prevention: Client status is ignored, forced to 'candidate'
  it('prevents approval bypass: POST /memory ignores client status="active" and forces "candidate"', async () => {
    const req = new Request('http://localhost/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}`, Origin: 'http://localhost:5173' },
      body: JSON.stringify({
        category: 'personal_preference',
        content: 'I prefer concise explanations.',
        status: 'active', // Malicious attempt to bypass approval
      }),
    });

    const res = await app.fetch(req, env);
    expect(res.status).toBe(201);
    const json: any = await res.json();
    expect(json.data.status).toBe('candidate');

    const created = mockDb.tables.memories.find((m) => m.id === json.data.id);
    expect(created.status).toBe('candidate');
  });

  // 2. Project Ownership Enforcement: Creation with foreign project ID is rejected
  it('rejects memory creation referencing another user project ID', async () => {
    const req = new Request('http://localhost/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}`, Origin: 'http://localhost:5173' },
      body: JSON.stringify({
        category: 'project',
        content: 'Confidential project details.',
        projectId: bobProjectId, // Alice tries to attach to Bob's project
      }),
    });

    const res = await app.fetch(req, env);
    expect(res.status).toBe(404);
    const json: any = await res.json();
    expect(json.error.code).toBe('PROJECT_UNAUTHORIZED');
  });

  // 3. Project Ownership Enforcement: Editing with foreign project ID is rejected
  it('rejects memory PATCH updating project_id to another user project', async () => {
    const memId = 'mem-alice-patch';
    mockDb.tables.memories.push({
      id: memId,
      user_id: testUserId,
      category: 'skill_knowledge',
      content: 'Knowledge about cloud workers',
      status: 'approved',
      is_pinned: 0,
      confidence: 0.9,
      importance: 0.5,
    });

    const req = new Request(`http://localhost/memory/${memId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}`, Origin: 'http://localhost:5173' },
      body: JSON.stringify({
        projectId: bobProjectId,
      }),
    });

    const res = await app.fetch(req, env);
    expect(res.status).toBe(404);
    const json: any = await res.json();
    expect(json.error.code).toBe('PROJECT_UNAUTHORIZED');
  });

  // 4. Project Ownership Enforcement: Graph entity creation with foreign project ID is rejected
  it('rejects knowledge graph entity creation referencing foreign project ID', async () => {
    const req = new Request('http://localhost/knowledge-graph/entities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}`, Origin: 'http://localhost:5173' },
      body: JSON.stringify({
        name: 'Foreign Entity',
        entityType: 'project',
        projectId: bobProjectId,
      }),
    });

    const res = await app.fetch(req, env);
    expect(res.status).toBe(404);
    const json: any = await res.json();
    expect(json.error.code).toBe('PROJECT_UNAUTHORIZED');
  });

  // 5. Secret Storage Bypass in Feedback: Rejects passwords & API keys
  it('rejects secrets and API keys submitted via feedback correction', async () => {
    const req = new Request('http://localhost/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}`, Origin: 'http://localhost:5173' },
      body: JSON.stringify({
        messageId: 'msg-alice-1',
        rating: 2,
        feedbackType: 'incorrect',
        correctionText: 'My secret password is: SuperSecretPassword123!',
      }),
    });

    const res = await app.fetch(req, env);
    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.error.code).toBe('SENSITIVE_DATA_BLOCKED');
  });

  // 6. Extraction Provenance: Rejects foreign conversation ID
  it('rejects memory extraction targeting a conversation owned by another user', async () => {
    const req = new Request('http://localhost/memory/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}`, Origin: 'http://localhost:5173' },
      body: JSON.stringify({
        conversationId: 'conv-bob-1',
        messages: [{ role: 'user', content: 'Extract preferences' }],
      }),
    });

    const res = await app.fetch(req, env);
    expect(res.status).toBe(404);
    const json: any = await res.json();
    expect(json.error.code).toBe('CONVERSATION_UNAUTHORIZED');
  });

  // 7. Feedback Message Ownership: Rejects foreign message ID
  it('rejects feedback targeting a message owned by another user', async () => {
    const req = new Request('http://localhost/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}`, Origin: 'http://localhost:5173' },
      body: JSON.stringify({
        messageId: 'msg-bob-1',
        rating: 3,
        feedbackType: 'useful',
      }),
    });

    const res = await app.fetch(req, env);
    expect(res.status).toBe(404);
    const json: any = await res.json();
    expect(json.error.code).toBe('MESSAGE_UNAUTHORIZED');
  });

  // 8. Feedback Memory Ownership: Rejects referencing foreign memory IDs
  it('rejects feedback referencing memory IDs belonging to another user', async () => {
    const bobMemId = 'mem-bob-classified';
    mockDb.tables.memories.push({
      id: bobMemId,
      user_id: bobUserId,
      category: 'decision',
      content: 'Bob proprietary decision',
      status: 'approved',
    });

    const req = new Request('http://localhost/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}`, Origin: 'http://localhost:5173' },
      body: JSON.stringify({
        messageId: 'msg-alice-1',
        rating: 1,
        feedbackType: 'wrong_memory',
        memoryIds: [bobMemId],
      }),
    });

    const res = await app.fetch(req, env);
    expect(res.status).toBe(404);
    const json: any = await res.json();
    expect(json.error.code).toBe('MEMORY_UNAUTHORIZED');
  });

  // 9. Memory Input Validation: Rejects invalid categories and out-of-range values
  it('validates memory category, importance, and confidence bounds', async () => {
    const badCategoryReq = new Request('http://localhost/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}`, Origin: 'http://localhost:5173' },
      body: JSON.stringify({
        category: 'unsupported_category_name',
        content: 'Valid content',
      }),
    });
    const badCatRes = await app.fetch(badCategoryReq, env);
    expect(badCatRes.status).toBe(400);

    const badImportanceReq = new Request('http://localhost/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}`, Origin: 'http://localhost:5173' },
      body: JSON.stringify({
        category: 'personal_preference',
        content: 'Valid content',
        importance: 15.0, // Out of range
      }),
    });
    const badImpRes = await app.fetch(badImportanceReq, env);
    expect(badImpRes.status).toBe(400);
  });

  // 10. Complete Deletion Semantics: Cleans up memories and related memory graph entities
  it('DELETE /memory/all removes memories and cleans up memory graph entities', async () => {
    mockDb.tables.memories.push({
      id: 'mem-to-del-1',
      user_id: testUserId,
      category: 'skill_knowledge',
      content: 'Erase me',
      status: 'approved',
    });

    mockDb.tables.knowledge_entities.push(
      { id: 'ent-mem-1', user_id: testUserId, entity_type: 'memory', name: 'Memory Entity' },
      { id: 'ent-proj-1', user_id: testUserId, entity_type: 'project', name: 'Persistent Project Entity' }
    );

    const delReq = new Request('http://localhost/memory/all', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${userToken}`, Origin: 'http://localhost:5173' },
    });

    const delRes = await app.fetch(delReq, env);
    expect(delRes.status).toBe(200);

    expect(mockDb.tables.memories.filter((m) => m.user_id === testUserId).length).toBe(0);
    expect(mockDb.tables.knowledge_entities.find((e) => e.id === 'ent-mem-1')).toBeUndefined();
    expect(mockDb.tables.knowledge_entities.find((e) => e.id === 'ent-proj-1')).toBeDefined(); // Unrelated project entity preserved
  });

  // 11. Complete Retrieval Lifecycle & Approval
  it('supports memory creation, approval, pinning, and retrieval lifecycle', async () => {
    // 1. Create candidate
    const createReq = new Request('http://localhost/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}`, Origin: 'http://localhost:5173' },
      body: JSON.stringify({
        category: 'personal_preference',
        content: 'I prefer functional programming with TypeScript.',
        importance: 0.9,
      }),
    });
    const createRes = await app.fetch(createReq, env);
    expect(createRes.status).toBe(201);
    const createJson: any = await createRes.json();
    const memId = createJson.data.id;
    expect(createJson.data.status).toBe('candidate');

    // Candidate should NOT be returned by default in ordinary retrieval
    const retCandReq = new Request('http://localhost/memory/retrieve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}`, Origin: 'http://localhost:5173' },
      body: JSON.stringify({ query: 'functional programming' }),
    });
    const retCandRes = await app.fetch(retCandReq, env);
    const retCandJson: any = await retCandRes.json();
    expect(retCandJson.data.relevantMemories.length).toBe(0);

    // 2. Approve memory
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

    // 4. Retrieve approved & pinned memory
    const retReq = new Request('http://localhost/memory/retrieve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}`, Origin: 'http://localhost:5173' },
      body: JSON.stringify({ query: 'functional programming' }),
    });
    const retRes = await app.fetch(retReq, env);
    expect(retRes.status).toBe(200);
    const retJson: any = await retRes.json();
    expect(retJson.data.relevantMemories.length).toBe(1);
    expect(retJson.data.relevantMemories[0].id).toBe(memId);
  });
});
