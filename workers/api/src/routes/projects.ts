import { Hono } from 'hono';
import { Env } from '../index';
import { requireAuth, AuthContext } from '../middleware/auth';

export const projectsRouter = new Hono<{ Bindings: Env; Variables: AuthContext }>();
projectsRouter.use('*', requireAuth);

/**
 * GET /projects
 * List projects strictly owned by authenticated user.
 */
projectsRouter.get('/', async (c) => {
  const user = c.get('user');

  const rows = await c.env.DB
    .prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC')
    .bind(user.id)
    .all();

  return c.json({
    success: true,
    data: rows.results || [],
  });
});

/**
 * POST /projects
 * Create a new project workspace.
 */
projectsRouter.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);

  if (!body || !body.name) {
    return c.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'Project name is required.' } },
      400
    );
  }

  const { name, description, goals, techStack } = body;
  const id = crypto.randomUUID();

  await c.env.DB
    .prepare(
      `INSERT INTO projects (id, user_id, name, description, goals, tech_stack, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    )
    .bind(id, user.id, name.trim(), description || null, goals || null, techStack || null)
    .run();

  return c.json(
    {
      success: true,
      data: { id, name: name.trim() },
    },
    201
  );
});

/**
 * PATCH /projects/:id
 * Updates a project. Strictly checks ownership (WHERE id = ? AND user_id = ?).
 */
projectsRouter.patch('/:id', async (c) => {
  const user = c.get('user');
  const projId = c.req.param('id');
  const body = await c.req.json().catch(() => null);

  if (!body) {
    return c.json({ success: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
  }

  const { name, description, goals, techStack } = body;

  const res = await c.env.DB
    .prepare(
      `UPDATE projects 
       SET name = COALESCE(?, name),
           description = COALESCE(?, description),
           goals = COALESCE(?, goals),
           tech_stack = COALESCE(?, tech_stack),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`
    )
    .bind(name || null, description || null, goals || null, techStack || null, projId, user.id)
    .run();

  if ((res.meta.changes ?? 0) === 0) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Project not found or unauthorized.' } },
      404
    );
  }

  return c.json({
    success: true,
    data: { message: 'Project updated successfully.' },
  });
});

/**
 * DELETE /projects/:id
 * Deletes a project. Strictly checks ownership (WHERE id = ? AND user_id = ?).
 */
projectsRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  const projId = c.req.param('id');

  const res = await c.env.DB
    .prepare('DELETE FROM projects WHERE id = ? AND user_id = ?')
    .bind(projId, user.id)
    .run();

  if ((res.meta.changes ?? 0) === 0) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Project not found or unauthorized.' } },
      404
    );
  }

  return c.json({
    success: true,
    data: { message: 'Project deleted successfully.' },
  });
});
