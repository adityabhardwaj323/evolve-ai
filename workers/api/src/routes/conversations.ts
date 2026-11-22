import { Hono } from 'hono';
import { Env } from '../index';
import { requireAuth, AuthContext } from '../middleware/auth';

export const conversationsRouter = new Hono<{ Bindings: Env; Variables: AuthContext }>();
conversationsRouter.use('*', requireAuth);

/**
 * GET /conversations
 * List user's conversations strictly isolated by user_id
 */
conversationsRouter.get('/', async (c) => {
  const user = c.get('user');

  const rows = await c.env.DB
    .prepare(
      `SELECT id, user_id, project_id, title, provider_type, model, is_temporary, created_at, updated_at
       FROM conversations
       WHERE user_id = ?
       ORDER BY updated_at DESC`
    )
    .bind(user.id)
    .all();

  return c.json({
    success: true,
    data: rows.results || [],
  });
});

/**
 * GET /conversations/:id
 * Retrieve a specific conversation and its messages.
 * Strictly verifies ownership (WHERE id = ? AND user_id = ?).
 */
conversationsRouter.get('/:id', async (c) => {
  const user = c.get('user');
  const convId = c.req.param('id');

  const conv = await c.env.DB
    .prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?')
    .bind(convId, user.id)
    .first();

  if (!conv) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Conversation not found or unauthorized.' } },
      404
    );
  }

  const messages = await c.env.DB
    .prepare('SELECT * FROM messages WHERE conversation_id = ? AND user_id = ? ORDER BY created_at ASC')
    .bind(convId, user.id)
    .all();

  return c.json({
    success: true,
    data: {
      conversation: conv,
      messages: messages.results || [],
    },
  });
});

/**
 * POST /conversations
 * Create a new conversation.
 */
conversationsRouter.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);

  if (!body) {
    return c.json({ success: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
  }

  const { title, providerType, model, projectId, isTemporary } = body;
  const id = crypto.randomUUID();

  await c.env.DB
    .prepare(
      `INSERT INTO conversations (id, user_id, project_id, title, provider_type, model, is_temporary, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    )
    .bind(
      id,
      user.id,
      projectId || null,
      title || 'New Conversation',
      providerType || 'gemini',
      model || 'gemini-1.5-flash',
      isTemporary ? 1 : 0
    )
    .run();

  return c.json(
    {
      success: true,
      data: { id, title: title || 'New Conversation' },
    },
    201
  );
});

/**
 * DELETE /conversations/:id
 * Strictly checks user ownership before deleting.
 */
conversationsRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  const convId = c.req.param('id');

  const res = await c.env.DB
    .prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?')
    .bind(convId, user.id)
    .run();

  if ((res.meta.changes ?? 0) === 0) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Conversation not found or unauthorized.' } },
      404
    );
  }

  return c.json({
    success: true,
    data: { message: 'Conversation deleted successfully.' },
  });
});
