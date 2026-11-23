import { Hono } from 'hono';
import { Env } from '../index.js';
import { requireAuth, AuthContext } from '../middleware/auth.js';
import { FeedbackRecord, FeedbackType } from '@evolve-ai/shared-types';
import { containsSensitiveData } from '@evolve-ai/memory-engine';

export const feedbackRouter = new Hono<{ Bindings: Env; Variables: AuthContext }>();
feedbackRouter.use('*', requireAuth);

const ALLOWED_FEEDBACK_TYPES = new Set([
  'useful',
  'irrelevant',
  'incorrect',
  'incomplete',
  'outdated',
  'wrong_memory',
  'missed_context',
  'custom_correction',
]);

/**
 * GET /feedback
 * List feedback logs for user
 */
feedbackRouter.get('/', async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    'SELECT * FROM feedback WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  ).bind(user.id).all();

  const feedbackList = (rows.results || []).map((f: any) => ({
    id: f.id,
    userId: f.user_id,
    messageId: f.message_id,
    conversationId: f.conversation_id,
    providerType: f.provider_type,
    model: f.model,
    rating: f.rating,
    feedbackType: f.feedback_type as FeedbackType,
    correctionText: f.correction_text,
    memoryIds: f.memory_ids_json ? JSON.parse(f.memory_ids_json) : [],
    status: f.status,
    createdAt: f.created_at,
  }));

  return c.json({
    success: true,
    data: feedbackList,
  });
});

/**
 * POST /feedback
 * Submit user feedback on assistant response with optional correction text.
 * When user supplies a correction, generates a suggested candidate memory.
 */
feedbackRouter.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);

  if (!body || !body.messageId || body.rating === undefined || !body.feedbackType) {
    return c.json({ success: false, error: { code: 'INVALID_INPUT', message: 'messageId, rating, and feedbackType are required.' } }, 400);
  }

  const { messageId, conversationId, providerType, model, rating, feedbackType, correctionText, memoryIds } = body;

  if (typeof rating !== 'number' || rating < 1 || rating > 5) {
    return c.json({ success: false, error: { code: 'INVALID_RATING', message: 'Rating must be an integer between 1 and 5.' } }, 400);
  }

  if (!ALLOWED_FEEDBACK_TYPES.has(feedbackType)) {
    return c.json({ success: false, error: { code: 'INVALID_FEEDBACK_TYPE', message: `Invalid feedbackType. Allowed: ${Array.from(ALLOWED_FEEDBACK_TYPES).join(', ')}` } }, 400);
  }

  // Verify conversation ownership if conversationId is provided
  if (conversationId) {
    const conv = await c.env.DB.prepare(
      'SELECT id FROM conversations WHERE id = ? AND user_id = ?'
    ).bind(conversationId, user.id).first();
    if (!conv) {
      return c.json({ success: false, error: { code: 'CONVERSATION_UNAUTHORIZED', message: 'Conversation not found or unauthorized.' } }, 404);
    }
  }

  // Verify message ownership if messageId is provided
  const msg = await c.env.DB.prepare(
    'SELECT id, conversation_id FROM messages WHERE id = ? AND user_id = ?'
  ).bind(messageId, user.id).first<any>();
  if (!msg) {
    return c.json({ success: false, error: { code: 'MESSAGE_UNAUTHORIZED', message: 'Message not found or unauthorized.' } }, 404);
  }

  // Verify referenced memory IDs belong to authenticated user
  if (Array.isArray(memoryIds) && memoryIds.length > 0) {
    for (const memId of memoryIds) {
      const owned = await c.env.DB.prepare(
        'SELECT id FROM memories WHERE id = ? AND user_id = ?'
      ).bind(memId, user.id).first();
      if (!owned) {
        return c.json({ success: false, error: { code: 'MEMORY_UNAUTHORIZED', message: `Referenced memory ${memId} not found or unauthorized.` } }, 404);
      }
    }
  }

  // Validate correctionText if present
  if (correctionText !== undefined && correctionText !== null) {
    if (typeof correctionText !== 'string' || correctionText.length > 2000) {
      return c.json({ success: false, error: { code: 'INVALID_CORRECTION', message: 'Correction text must be a string under 2000 characters.' } }, 400);
    }

    if (containsSensitiveData(correctionText)) {
      return c.json({
        success: false,
        error: { code: 'SENSITIVE_DATA_BLOCKED', message: 'Feedback correction cannot contain API keys, passwords, or secrets.' },
      }, 400);
    }
  }

  const id = crypto.randomUUID();

  await c.env.DB.prepare(
    `INSERT INTO feedback (
      id, user_id, message_id, conversation_id, provider_type, model,
      rating, feedback_type, correction_text, memory_ids_json, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', CURRENT_TIMESTAMP)`
  ).bind(
    id,
    user.id,
    messageId,
    conversationId || msg.conversation_id || null,
    providerType || null,
    model || null,
    rating,
    feedbackType,
    correctionText ? correctionText.trim() : null,
    memoryIds ? JSON.stringify(memoryIds) : null
  ).run();

  let generatedCandidateId: string | null = null;

  // If correction is provided, create a pending candidate memory in category 'correction' (strictly candidate status)
  if (correctionText && correctionText.trim()) {
    generatedCandidateId = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO memories (
        id, user_id, category, title, content, confidence, importance,
        source_type, source_id, source_message_id, status, verification_status, is_pinned, created_at, updated_at
      ) VALUES (?, ?, 'correction', ?, ?, 0.95, 0.8, 'feedback_correction', ?, ?, 'candidate', 'unverified', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).bind(
      generatedCandidateId,
      user.id,
      `Correction: ${correctionText.slice(0, 35)}`,
      correctionText.trim(),
      conversationId || msg.conversation_id || null,
      messageId
    ).run();

    await c.env.DB.prepare(
      'UPDATE feedback SET status = "applied_to_candidate_memory" WHERE id = ?'
    ).bind(id).run();
  }

  return c.json({
    success: true,
    data: {
      id,
      status: generatedCandidateId ? 'applied_to_candidate_memory' : 'received',
      generatedCandidateId,
      message: 'Feedback recorded successfully.',
    },
  }, 201);
});
