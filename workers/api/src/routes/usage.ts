import { Hono } from 'hono';
import { Env } from '../index.js';
import { requireAuth, AuthContext } from '../middleware/auth.js';

export const usageRouter = new Hono<{ Bindings: Env; Variables: AuthContext }>();
usageRouter.use('*', requireAuth);

/**
 * GET /usage
 * Returns aggregate and recent token usage information for the authenticated user
 */
usageRouter.get('/', async (c) => {
  const user = c.get('user');

  // Total summary
  const summary = await c.env.DB
    .prepare(
      `SELECT 
         COUNT(*) as total_requests,
         SUM(prompt_tokens) as total_prompt_tokens,
         SUM(completion_tokens) as total_completion_tokens,
         SUM(total_tokens) as total_tokens
       FROM usage_events
       WHERE user_id = ?`
    )
    .bind(user.id)
    .first<any>();

  // By provider breakdown
  const byProvider = await c.env.DB
    .prepare(
      `SELECT 
         provider_type,
         COUNT(*) as requests,
         SUM(total_tokens) as tokens
       FROM usage_events
       WHERE user_id = ?
       GROUP BY provider_type`
    )
    .bind(user.id)
    .all<any>();

  // Recent 20 events
  const recentEvents = await c.env.DB
    .prepare(
      `SELECT id, provider_type, model, prompt_tokens, completion_tokens, total_tokens, success, created_at
       FROM usage_events
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 20`
    )
    .bind(user.id)
    .all<any>();

  return c.json({
    success: true,
    data: {
      summary: {
        totalRequests: summary?.total_requests || 0,
        totalPromptTokens: summary?.total_prompt_tokens || 0,
        totalCompletionTokens: summary?.total_completion_tokens || 0,
        totalTokens: summary?.total_tokens || 0,
      },
      byProvider: byProvider.results || [],
      recentEvents: recentEvents.results || [],
    },
  });
});
