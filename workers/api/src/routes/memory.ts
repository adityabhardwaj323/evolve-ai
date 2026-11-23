import { Hono } from 'hono';
import { Env } from '../index.js';
import { requireAuth, AuthContext } from '../middleware/auth.js';
import {
  retrieveRelevantMemories,
  buildMemoryContextPackage,
  buildMemoryExtractionPrompt,
  parseExtractionResponse,
  deduplicateAndDetectConflicts,
  MemoryLifecycle,
  containsSensitiveData,
} from '@evolve-ai/memory-engine';
import { Memory, MemoryCategory, MemoryStatus, VerificationStatus } from '@evolve-ai/shared-types';
import { ProviderRegistry } from '@evolve-ai/provider-sdk';
import { decryptCredential } from '../security/crypto.js';

export const memoryRouter = new Hono<{ Bindings: Env; Variables: AuthContext }>();
memoryRouter.use('*', requireAuth);

const registry = ProviderRegistry.getInstance();

/**
 * Helper to map DB row to shared Memory interface
 */
function mapMemoryRow(row: any): Memory {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id || null,
    category: row.category,
    title: row.title || row.content.slice(0, 40),
    content: row.content,
    confidence: row.confidence ?? 0.8,
    importance: row.importance ?? 0.5,
    sourceType: row.source_type || 'direct_entry',
    sourceId: row.source_id || null,
    sourceMessageId: row.source_message_id || null,
    status: row.status as MemoryStatus,
    verificationStatus: (row.verification_status || 'unverified') as VerificationStatus,
    isPinned: Boolean(row.is_pinned),
    expiresAt: row.expires_at || null,
    lastAccessedAt: row.last_accessed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * GET /memory
 * List memories with search, category, status, project filters and pagination
 */
memoryRouter.get('/', async (c) => {
  const user = c.get('user');
  const status = c.req.query('status');
  const category = c.req.query('category');
  const projectId = c.req.query('projectId');
  const search = c.req.query('search');
  const limit = Math.min(Number(c.req.query('limit')) || 50, 100);
  const offset = Number(c.req.query('offset')) || 0;

  let query = 'SELECT * FROM memories WHERE user_id = ?';
  const params: any[] = [user.id];

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  } else {
    // By default exclude deleted
    query += ' AND status != "deleted"';
  }

  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }

  if (projectId !== undefined) {
    if (projectId === 'null' || projectId === '') {
      query += ' AND project_id IS NULL';
    } else {
      query += ' AND project_id = ?';
      params.push(projectId);
    }
  }

  if (search && search.trim()) {
    query += ' AND (content LIKE ? OR title LIKE ?)';
    const searchPattern = `%${search.trim()}%`;
    params.push(searchPattern, searchPattern);
  }

  query += ' ORDER BY is_pinned DESC, updated_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = await c.env.DB.prepare(query).bind(...params).all();
  const memories = (rows.results || []).map(mapMemoryRow);

  return c.json({
    success: true,
    data: memories,
  });
});

/**
 * GET /memory/stats
 * Overview counts for categories, statuses, and evolution metrics
 */
memoryRouter.get('/stats', async (c) => {
  const user = c.get('user');

  const rows = await c.env.DB.prepare(
    `SELECT 
       COUNT(*) as total,
       SUM(CASE WHEN status = 'approved' OR status = 'active' THEN 1 ELSE 0 END) as active_count,
       SUM(CASE WHEN status = 'candidate' THEN 1 ELSE 0 END) as candidate_count,
       SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_count,
       SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) as archived_count,
       SUM(CASE WHEN is_pinned = 1 THEN 1 ELSE 0 END) as pinned_count
     FROM memories WHERE user_id = ? AND status != 'deleted'`
  ).bind(user.id).first<any>();

  const retrievals = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM memory_access_logs WHERE user_id = ?'
  ).bind(user.id).first<any>();

  const corrections = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM feedback WHERE user_id = ? AND feedback_type IN ("incorrect", "incomplete", "outdated", "custom_correction")'
  ).bind(user.id).first<any>();

  return c.json({
    success: true,
    data: {
      total: rows?.total || 0,
      active: rows?.active_count || 0,
      candidates: rows?.candidate_count || 0,
      rejected: rows?.rejected_count || 0,
      archived: rows?.archived_count || 0,
      pinned: rows?.pinned_count || 0,
      totalRetrievals: retrievals?.count || 0,
      totalCorrections: corrections?.count || 0,
    },
  });
});

/**
 * POST /memory
 * Create a new personal memory explicitly
 */
memoryRouter.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);

  if (!body || !body.content || !body.category) {
    return c.json({ success: false, error: { code: 'INVALID_INPUT', message: 'content and category are required.' } }, 400);
  }

  if (containsSensitiveData(body.content)) {
    return c.json({
      success: false,
      error: { code: 'SENSITIVE_DATA_BLOCKED', message: 'Personal memory cannot store passwords, API keys, or financial secrets.' },
    }, 400);
  }

  const { content, category, title, projectId, sourceType, sourceId, sourceMessageId, status, confidence, importance } = body;
  const id = crypto.randomUUID();

  await c.env.DB.prepare(
    `INSERT INTO memories (
      id, user_id, project_id, category, title, content, confidence, importance,
      source_type, source_id, source_message_id, status, verification_status,
      is_pinned, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unverified', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).bind(
    id,
    user.id,
    projectId || null,
    category,
    title || content.slice(0, 40),
    content.trim(),
    confidence ?? 0.8,
    importance ?? 0.5,
    sourceType || 'direct_entry',
    sourceId || null,
    sourceMessageId || null,
    status || 'candidate'
  ).run();

  return c.json({
    success: true,
    data: { id, content, category, status: status || 'candidate' },
  }, 201);
});

/**
 * POST /memory/extract
 * Extracts candidate memories from conversation text using user-connected AI model or deterministic fallback.
 * Strictly respects user auto_memory_approval and auto_memory_extract settings.
 */
memoryRouter.post('/extract', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const { messages, conversationId, providerType, credentialId } = body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return c.json({ success: false, error: { code: 'INVALID_INPUT', message: 'messages array is required.' } }, 400);
  }

  // Load existing user memories to avoid reintroducing duplicates
  const existingRows = await c.env.DB.prepare(
    'SELECT * FROM memories WHERE user_id = ? AND status != "deleted"'
  ).bind(user.id).all();
  const existingMemories = (existingRows.results || []).map(mapMemoryRow);

  // Check user preferences
  const prefs = await c.env.DB.prepare(
    'SELECT auto_memory_extract, auto_memory_approval FROM user_preferences WHERE user_id = ?'
  ).bind(user.id).first<any>();

  if (prefs && prefs.auto_memory_extract === 0) {
    return c.json({ success: true, data: { candidates: [], message: 'Memory extraction is disabled in user preferences.' } });
  }

  let candidates: any[] = [];
  const latestUserText = messages.filter((m: any) => m.role === 'user').pop()?.content || '';

  // If user provided provider credentials, attempt structured extraction via provider
  if (providerType) {
    try {
      const cred = await c.env.DB.prepare(
        'SELECT id, encrypted_key, key_iv, encryption_version, custom_endpoint, default_model FROM provider_credentials WHERE user_id = ? AND provider_type = ? AND is_active = 1'
      ).bind(user.id, providerType).first<any>();

      if (cred) {
        const rawKey = await decryptCredential(
          { encryptedKey: cred.encrypted_key, keyIv: cred.key_iv, encryptionVersion: cred.encryption_version },
          c.env.ENCRYPTION_SECRET,
          { userId: user.id, credentialId: cred.id }
        );

        const adapter = registry.get(providerType);
        const prompt = buildMemoryExtractionPrompt(messages, existingMemories);
        const res = await adapter.generateText(rawKey, {
          model: cred.default_model,
          messages: [{ role: 'user', content: prompt }],
          maxTokens: 512,
          temperature: 0.1,
        }, cred.custom_endpoint);

        candidates = parseExtractionResponse(res.content, latestUserText);
      }
    } catch {
      // Fallback to deterministic extraction on model failure
      candidates = parseExtractionResponse('', latestUserText);
    }
  } else {
    candidates = parseExtractionResponse('', latestUserText);
  }

  // Deduplicate and detect conflicts
  const evaluatedCandidates = deduplicateAndDetectConflicts(candidates, existingMemories);

  // If auto-save policy is enabled, persist non-duplicate candidates as approved
  const autoApprove = prefs?.auto_memory_approval === 1;
  const createdIds: string[] = [];

  for (const item of evaluatedCandidates) {
    if (item.suggestedAction === 'create' || (autoApprove && !item.possibleDuplicateId)) {
      const id = crypto.randomUUID();
      const status: MemoryStatus = autoApprove ? 'approved' : 'candidate';
      await c.env.DB.prepare(
        `INSERT INTO memories (
          id, user_id, category, title, content, confidence, importance,
          source_type, source_id, status, verification_status, is_pinned, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'conversation', ?, ?, 'unverified', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      ).bind(
        id,
        user.id,
        item.category,
        item.title,
        item.content,
        item.confidence,
        item.importance,
        conversationId || null,
        status
      ).run();
      createdIds.push(id);
    }
  }

  return c.json({
    success: true,
    data: {
      candidates: evaluatedCandidates,
      createdIds,
      autoApproved: autoApprove,
    },
  });
});

/**
 * POST /memory/retrieve
 * Hybrid retrieval endpoint for AI inference context injection
 */
memoryRouter.post('/retrieve', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);

  if (!body || !body.query) {
    return c.json({ success: false, error: { code: 'INVALID_INPUT', message: 'query string is required.' } }, 400);
  }

  const { query, projectId, limit, categories, includeCandidates } = body;

  const rows = await c.env.DB.prepare(
    'SELECT * FROM memories WHERE user_id = ? AND status != "deleted"'
  ).bind(user.id).all();

  const allMemories = (rows.results || []).map(mapMemoryRow);
  const relevant = retrieveRelevantMemories(allMemories, {
    userId: user.id,
    projectId: projectId || null,
    query,
    limit: limit || 6,
    categories,
    includeCandidates,
  });

  // Log retrieval in memory_access_logs
  for (const m of relevant) {
    await c.env.DB.prepare(
      `INSERT INTO memory_access_logs (id, user_id, memory_id, retrieval_query, created_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(crypto.randomUUID(), user.id, m.id, query.slice(0, 100)).run();

    await c.env.DB.prepare(
      'UPDATE memories SET last_accessed_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?'
    ).bind(m.id, user.id).run();
  }

  // Load project context if requested
  let projectDetails = null;
  if (projectId) {
    projectDetails = await c.env.DB.prepare(
      'SELECT id, name, description, goals, tech_stack FROM projects WHERE id = ? AND user_id = ?'
    ).bind(projectId, user.id).first<any>();
  }

  const contextPackage = buildMemoryContextPackage(relevant, projectDetails);

  return c.json({
    success: true,
    data: contextPackage,
  });
});

/**
 * POST /memory/:id/approve
 */
memoryRouter.post('/:id/approve', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const row = await c.env.DB.prepare('SELECT * FROM memories WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!row) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Memory not found.' } }, 404);

  const memory = mapMemoryRow(row);
  const approved = MemoryLifecycle.approve(memory);

  await c.env.DB.prepare(
    'UPDATE memories SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?'
  ).bind(approved.status, id, user.id).run();

  return c.json({ success: true, data: approved });
});

/**
 * POST /memory/:id/reject
 */
memoryRouter.post('/:id/reject', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const row = await c.env.DB.prepare('SELECT * FROM memories WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!row) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Memory not found.' } }, 404);

  const memory = mapMemoryRow(row);
  const rejected = MemoryLifecycle.reject(memory);

  await c.env.DB.prepare(
    'UPDATE memories SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?'
  ).bind(rejected.status, id, user.id).run();

  return c.json({ success: true, data: rejected });
});

/**
 * POST /memory/:id/archive
 */
memoryRouter.post('/:id/archive', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const row = await c.env.DB.prepare('SELECT * FROM memories WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!row) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Memory not found.' } }, 404);

  const memory = mapMemoryRow(row);
  const archived = MemoryLifecycle.archive(memory);

  await c.env.DB.prepare(
    'UPDATE memories SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?'
  ).bind(archived.status, id, user.id).run();

  return c.json({ success: true, data: archived });
});

/**
 * POST /memory/:id/restore
 */
memoryRouter.post('/:id/restore', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const row = await c.env.DB.prepare('SELECT * FROM memories WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!row) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Memory not found.' } }, 404);

  const memory = mapMemoryRow(row);
  const restored = MemoryLifecycle.restore(memory);

  await c.env.DB.prepare(
    'UPDATE memories SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?'
  ).bind(restored.status, id, user.id).run();

  return c.json({ success: true, data: restored });
});

/**
 * POST /memory/:id/pin
 */
memoryRouter.post('/:id/pin', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const row = await c.env.DB.prepare('SELECT is_pinned FROM memories WHERE id = ? AND user_id = ?').bind(id, user.id).first<any>();
  if (!row) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Memory not found.' } }, 404);

  const newPinState = row.is_pinned === 1 ? 0 : 1;
  await c.env.DB.prepare(
    'UPDATE memories SET is_pinned = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?'
  ).bind(newPinState, id, user.id).run();

  return c.json({ success: true, data: { id, isPinned: Boolean(newPinState) } });
});

/**
 * PATCH /memory/:id
 * Edit content, title, category, importance, or verification status
 */
memoryRouter.patch('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);

  if (!body) {
    return c.json({ success: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
  }

  const { title, content, category, importance, verificationStatus, projectId } = body;

  if (content && containsSensitiveData(content)) {
    return c.json({
      success: false,
      error: { code: 'SENSITIVE_DATA_BLOCKED', message: 'Cannot save sensitive secrets or passwords in memory.' },
    }, 400);
  }

  const res = await c.env.DB.prepare(
    `UPDATE memories 
     SET title = COALESCE(?, title),
         content = COALESCE(?, content),
         category = COALESCE(?, category),
         importance = COALESCE(?, importance),
         verification_status = COALESCE(?, verification_status),
         project_id = COALESCE(?, project_id),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`
  ).bind(
    title || null,
    content || null,
    category || null,
    importance ?? null,
    verificationStatus || null,
    projectId !== undefined ? (projectId || null) : null,
    id,
    user.id
  ).run();

  if ((res.meta.changes ?? 0) === 0) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Memory not found or unauthorized.' } }, 404);
  }

  return c.json({ success: true, data: { message: 'Memory updated successfully.' } });
});

/**
 * GET /memory/export
 * Export user's complete memory history as JSON
 */
memoryRouter.get('/export', async (c) => {
  const user = c.get('user');

  const rows = await c.env.DB.prepare(
    'SELECT * FROM memories WHERE user_id = ? AND status != "deleted" ORDER BY created_at ASC'
  ).bind(user.id).all();

  const memories = (rows.results || []).map(mapMemoryRow);

  return c.json({
    success: true,
    data: {
      exportedAt: new Date().toISOString(),
      user: { id: user.id, email: user.email },
      memories,
    },
  });
});

/**
 * DELETE /memory/all
 * Complete deletion of all user memories (Privacy / Right to be Forgotten)
 */
memoryRouter.delete('/all', async (c) => {
  const user = c.get('user');

  const res = await c.env.DB.prepare(
    'DELETE FROM memories WHERE user_id = ?'
  ).bind(user.id).run();

  await c.env.DB.prepare(
    'DELETE FROM memory_access_logs WHERE user_id = ?'
  ).bind(user.id).run();

  return c.json({
    success: true,
    data: { deletedCount: res.meta.changes ?? 0, message: 'All personal memories deleted successfully.' },
  });
});

/**
 * DELETE /memory/:id
 */
memoryRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  const memId = c.req.param('id');

  const res = await c.env.DB
    .prepare('DELETE FROM memories WHERE id = ? AND user_id = ?')
    .bind(memId, user.id)
    .run();

  if ((res.meta.changes ?? 0) === 0) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Memory not found or unauthorized.' } }, 404);
  }

  return c.json({
    success: true,
    data: { message: 'Memory deleted successfully.' },
  });
});
