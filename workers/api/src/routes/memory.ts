import { Hono } from 'hono';
import { Env } from '../index';
import { requireAuth, AuthContext } from '../middleware/auth';

export const memoryRouter = new Hono<{ Bindings: Env; Variables: AuthContext }>();
memoryRouter.use('*', requireAuth);

/**
 * GET /memory
 * List memories for the authenticated user, strictly filtered by user_id.
 */
memoryRouter.get('/', async (c) => {
  const user = c.get('user');
  const status = c.req.query('status');

  let query = 'SELECT * FROM memories WHERE user_id = ?';
  const params: (string | number)[] = [user.id];

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  query += ' ORDER BY created_at DESC';

  const rows = await c.env.DB.prepare(query).bind(...params).all();

  return c.json({
    success: true,
    data: rows.results || [],
  });
});

/**
 * POST /memory
 * Create a new personal memory.
 */
memoryRouter.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);

  if (!body || !body.content || !body.category) {
    return c.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'content and category are required.' } },
      400
    );
  }

  const { content, category, projectId, sourceType, sourceId, status, confidence } = body;
  const id = crypto.randomUUID();

  await c.env.DB
    .prepare(
      `INSERT INTO memories (
        id, user_id, project_id, category, content, source_type, source_id, status, confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    )
    .bind(
      id,
      user.id,
      projectId || null,
      category,
      content.trim(),
      sourceType || 'direct_entry',
      sourceId || null,
      status || 'candidate',
      confidence ?? 0.8
    )
    .run();

  return c.json(
    {
      success: true,
      data: { id, content, category, status: status || 'candidate' },
    },
    201
  );
});

/**
 * DELETE /memory/:id
 * Strictly checks ownership (WHERE id = ? AND user_id = ?).
 */
memoryRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  const memId = c.req.param('id');

  const res = await c.env.DB
    .prepare('DELETE FROM memories WHERE id = ? AND user_id = ?')
    .bind(memId, user.id)
    .run();

  if ((res.meta.changes ?? 0) === 0) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Memory not found or unauthorized.' } },
      404
    );
  }

  return c.json({
    success: true,
    data: { message: 'Memory deleted successfully.' },
  });
});
