import { Hono } from 'hono';
import { Env } from '../index.js';
import { requireAuth, AuthContext } from '../middleware/auth.js';
import { KnowledgeEntity, KnowledgeRelation } from '@evolve-ai/shared-types';

export const graphRouter = new Hono<{ Bindings: Env; Variables: AuthContext }>();
graphRouter.use('*', requireAuth);

const ALLOWED_ENTITY_TYPES = new Set(['user', 'project', 'technology', 'skill', 'goal', 'decision', 'memory', 'concept']);
const ALLOWED_RELATION_TYPES = new Set([
  'USER_WORKS_ON_PROJECT',
  'PROJECT_USES_TECHNOLOGY',
  'USER_HAS_SKILL',
  'USER_HAS_GOAL',
  'MEMORY_BELONGS_TO_PROJECT',
  'MEMORY_RELATES_TO_MEMORY',
  'DECISION_AFFECTS_PROJECT',
  'RELATESTO',
]);

/**
 * Validates that a project exists and is owned by the user.
 */
async function validateProjectOwnership(db: D1Database, userId: string, projectId: string): Promise<boolean> {
  const row = await db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first();
  return Boolean(row);
}

/**
 * GET /knowledge-graph
 * Retrieve full or project-filtered graph nodes (entities) and edges (relations)
 */
graphRouter.get('/', async (c) => {
  const user = c.get('user');
  const projectId = c.req.query('projectId');

  if (projectId) {
    const isOwner = await validateProjectOwnership(c.env.DB, user.id, projectId);
    if (!isOwner) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Project not found or unauthorized.' } }, 404);
    }
  }

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
 * Create entity with strict type and ownership validation
 */
graphRouter.post('/entities', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);

  if (!body || !body.name || !body.entityType) {
    return c.json({ success: false, error: { code: 'INVALID_INPUT', message: 'name and entityType are required.' } }, 400);
  }

  const name = String(body.name).trim();
  const entityType = String(body.entityType).toLowerCase().trim();
  const description = body.description ? String(body.description).trim() : null;

  if (name.length === 0 || name.length > 100) {
    return c.json({ success: false, error: { code: 'INVALID_INPUT', message: 'Entity name must be between 1 and 100 characters.' } }, 400);
  }

  if (description && description.length > 500) {
    return c.json({ success: false, error: { code: 'INVALID_INPUT', message: 'Description cannot exceed 500 characters.' } }, 400);
  }

  if (!ALLOWED_ENTITY_TYPES.has(entityType)) {
    return c.json({ success: false, error: { code: 'INVALID_TYPE', message: `Invalid entityType. Allowed: ${Array.from(ALLOWED_ENTITY_TYPES).join(', ')}` } }, 400);
  }

  if (body.projectId) {
    const isOwner = await validateProjectOwnership(c.env.DB, user.id, body.projectId);
    if (!isOwner) {
      return c.json({ success: false, error: { code: 'PROJECT_UNAUTHORIZED', message: 'Project not found or not owned by user.' } }, 404);
    }
  }

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO knowledge_entities (id, user_id, project_id, name, entity_type, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).bind(
    id,
    user.id,
    body.projectId || null,
    name,
    entityType,
    description
  ).run();

  return c.json({
    success: true,
    data: { id, name, entityType, projectId: body.projectId || null },
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

  const relationType = String(body.relationType).toUpperCase().trim();
  if (!ALLOWED_RELATION_TYPES.has(relationType)) {
    return c.json({ success: false, error: { code: 'INVALID_RELATION_TYPE', message: `Invalid relationType. Allowed: ${Array.from(ALLOWED_RELATION_TYPES).join(', ')}` } }, 400);
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
  ).bind(id, user.id, body.sourceEntityId, body.targetEntityId, relationType).run();

  return c.json({
    success: true,
    data: { id, sourceEntityId: body.sourceEntityId, targetEntityId: body.targetEntityId, relationType },
  }, 201);
});

/**
 * DELETE /knowledge-graph/entities/:id
 */
graphRouter.delete('/entities/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  // Also clean up relations referencing this entity
  await c.env.DB.prepare(
    'DELETE FROM knowledge_relations WHERE user_id = ? AND (source_entity_id = ? OR target_entity_id = ?)'
  ).bind(user.id, id, id).run();

  const res = await c.env.DB.prepare('DELETE FROM knowledge_entities WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  if ((res.meta.changes ?? 0) === 0) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Entity not found.' } }, 404);
  }

  return c.json({ success: true, data: { message: 'Entity deleted.' } });
});
