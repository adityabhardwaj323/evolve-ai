import { Hono } from 'hono';
import { Env } from '../index.js';
import { requireAuth, AuthContext } from '../middleware/auth.js';
import { FeedbackRecord, FeedbackType } from '@evolve-ai/shared-types';

export const feedbackRouter = new Hono<{ Bindings: Env; Variables: AuthContext }>();
feedbackRouter.use('*', requireAuth);

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
    conversationId || null,
    providerType || null,
    model || null,
    rating,
    feedbackType,
    correctionText || null,
    memoryIds ? JSON.stringify(memoryIds) : null
  ).run();

  let generatedCandidateId: string | null = null;

  // If correction is provided, create a pending candidate memory in category 'correction'
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
      conversationId || null,
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
