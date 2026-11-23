import { Hono } from 'hono';
import { Env } from '../index.js';
import { requireAuth, AuthContext } from '../middleware/auth.js';
import { KnowledgeEntity, KnowledgeRelation } from '@evolve-ai/shared-types';

export const graphRouter = new Hono<{ Bindings: Env; Variables: AuthContext }>();
graphRouter.use('*', requireAuth);

/**
 * GET /knowledge-graph
 * Retrieve full or project-filtered graph nodes (entities) and edges (relations)
 */
graphRouter.get('/', async (c) => {
  const user = c.get('user');
  const projectId = c.req.query('projectId');

  let entityQuery = 'SELECT * FROM knowledge_entities WHERE user_id = ?';
  const entityParams: any[] = [user.id];

  if (projectId) {
    entityQuery += ' AND (project_id = ? OR project_id IS NULL)';
    entityParams.push(projectId);
  }

  const entities = await c.env.DB.prepare(entityQuery).bind(...entityParams).all();

  const entityIds = new Set((entities.results || []).map((e: any) => e.id));

  // Fetch relations owned by user where both source and target exist
  const relations = await c.env.DB.prepare(
    'SELECT * FROM knowledge_relations WHERE user_id = ?'
  ).bind(user.id).all();

  const validRelations = (relations.results || []).filter(
    (r: any) => entityIds.has(r.source_entity_id) && entityIds.has(r.target_entity_id)
  );

  return c.json({
    success: true,
    data: {
      entities: (entities.results || []).map((e: any) => ({
        id: e.id,
        userId: e.user_id,
        projectId: e.project_id,
        name: e.name,
        entityType: e.entity_type,
        description: e.description,
        createdAt: e.created_at,
      })),
      relations: validRelations.map((r: any) => ({
        id: r.id,
        userId: r.user_id,
        sourceEntityId: r.source_entity_id,
        targetEntityId: r.target_entity_id,
        relationType: r.relation_type,
        createdAt: r.created_at,
      })),
    },
  });
});

/**
 * POST /knowledge-graph/entities
 * Create entity
 */
graphRouter.post('/entities', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);

  if (!body || !body.name || !body.entityType) {
    return c.json({ success: false, error: { code: 'INVALID_INPUT', message: 'name and entityType are required.' } }, 400);
  }

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO knowledge_entities (id, user_id, project_id, name, entity_type, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).bind(
    id,
    user.id,
    body.projectId || null,
    body.name.trim(),
    body.entityType,
    body.description || null
  ).run();

  return c.json({
    success: true,
    data: { id, name: body.name, entityType: body.entityType },
  }, 201);
});

/**
 * POST /knowledge-graph/relations
 * Create relationship between two user-owned entities
 */
graphRouter.post('/relations', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);

  if (!body || !body.sourceEntityId || !body.targetEntityId || !body.relationType) {
    return c.json({ success: false, error: { code: 'INVALID_INPUT', message: 'sourceEntityId, targetEntityId, and relationType are required.' } }, 400);
  }

  // Verify both entities belong to user
  const source = await c.env.DB.prepare('SELECT id FROM knowledge_entities WHERE id = ? AND user_id = ?').bind(body.sourceEntityId, user.id).first();
  const target = await c.env.DB.prepare('SELECT id FROM knowledge_entities WHERE id = ? AND user_id = ?').bind(body.targetEntityId, user.id).first();

  if (!source || !target) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Source or target entity not found or unauthorized.' } }, 404);
  }

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO knowledge_relations (id, user_id, source_entity_id, target_entity_id, relation_type, created_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).bind(id, user.id, body.sourceEntityId, body.targetEntityId, body.relationType).run();

  return c.json({
    success: true,
    data: { id, sourceEntityId: body.sourceEntityId, targetEntityId: body.targetEntityId, relationType: body.relationType },
  }, 201);
});

/**
 * DELETE /knowledge-graph/entities/:id
 */
graphRouter.delete('/entities/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const res = await c.env.DB.prepare('DELETE FROM knowledge_entities WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  if ((res.meta.changes ?? 0) === 0) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Entity not found.' } }, 404);
  }

  return c.json({ success: true, data: { message: 'Entity deleted.' } });
});
