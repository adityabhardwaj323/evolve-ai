import { Hono } from 'hono';
import { Env } from '../index.js';
import { requireAuth, AuthContext } from '../middleware/auth.js';
import { decryptCredential } from '../security/crypto.js';
import { ProviderRegistry } from '@evolve-ai/provider-sdk';
import { ProviderType, StreamEvent, Memory } from '@evolve-ai/shared-types';
import {
  retrieveRelevantMemories,
  buildMemoryContextPackage,
  formatMemoryContextPrompt,
} from '@evolve-ai/memory-engine';

export const chatRouter = new Hono<{ Bindings: Env; Variables: AuthContext }>();
chatRouter.use('*', requireAuth);

const registry = ProviderRegistry.getInstance();

/**
 * Note on Cross-Isolate Stream Cancellation:
 * In Cloudflare Workers, requests can be routed to different isolates.
 * Therefore, reliable stream cancellation is achieved directly via the original
 * streaming HTTP connection's `c.req.raw.signal`. When the client closes or aborts
 * the streaming request, `c.req.raw.signal` emits 'abort', propagating immediately
 * to the upstream provider fetch and terminating the connection.
 *
 * An in-memory Map (`localActiveGenerations`) is retained strictly as a best-effort
 * fallback within the same isolate for the optional POST /chat/stop endpoint,
 * but users and frontend clients MUST abort the original streaming request directly.
 */
const localActiveGenerations = new Map<string, AbortController>();

/**
 * Helper to retrieve and format personal memory context before dispatching to any provider
 */
async function resolveMemoryContext(
  db: D1Database,
  userId: string,
  latestPrompt: string,
  conversationId?: string
): Promise<{ effectiveSystemPrompt: string; injectedMemoryIds: string[] }> {
  // Check if user disabled memory injection
  const prefs = await db.prepare(
    'SELECT memory_injection_enabled FROM user_preferences WHERE user_id = ?'
  ).bind(userId).first<any>();

  if (prefs && prefs.memory_injection_enabled === 0) {
    return { effectiveSystemPrompt: '', injectedMemoryIds: [] };
  }

  // Check if conversation belongs to a project
  let projectId: string | null = null;
  if (conversationId) {
    const conv = await db.prepare('SELECT project_id FROM conversations WHERE id = ? AND user_id = ?')
      .bind(conversationId, userId).first<any>();
    if (conv?.project_id) {
      projectId = conv.project_id;
    }
  }

  // Load active/approved memories
  const rows = await db.prepare(
    'SELECT * FROM memories WHERE user_id = ? AND status != "deleted"'
  ).bind(userId).all();

  const allMemories: Memory[] = (rows.results || []).map((r: any) => ({
    id: r.id,
    userId: r.user_id,
    projectId: r.project_id || null,
    category: r.category,
    title: r.title,
    content: r.content,
    confidence: r.confidence ?? 0.8,
    importance: r.importance ?? 0.5,
    sourceType: r.source_type,
    sourceId: r.source_id,
    sourceMessageId: r.source_message_id,
    status: r.status,
    verificationStatus: r.verification_status || 'unverified',
    isPinned: Boolean(r.is_pinned),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  const relevant = retrieveRelevantMemories(allMemories, {
    userId,
    projectId,
    query: latestPrompt,
    limit: 5,
  });

  if (relevant.length === 0 && !projectId) {
    return { effectiveSystemPrompt: '', injectedMemoryIds: [] };
  }

  let projectDetails = null;
  if (projectId) {
    projectDetails = await db.prepare('SELECT id, name, description, goals, tech_stack FROM projects WHERE id = ? AND user_id = ?')
      .bind(projectId, userId).first<any>();
  }

  const contextPackage = buildMemoryContextPackage(relevant, projectDetails);
  const memoryBlock = formatMemoryContextPrompt(contextPackage);

  // Log retrieval in memory_access_logs
  for (const m of relevant) {
    await db.prepare(
      `INSERT INTO memory_access_logs (id, user_id, conversation_id, memory_id, retrieval_query, created_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(crypto.randomUUID(), userId, conversationId || null, m.id, latestPrompt.slice(0, 100)).run();
  }

  return {
    effectiveSystemPrompt: memoryBlock,
    injectedMemoryIds: relevant.map((m) => m.id),
  };
}
async function getDecryptedCredential(
  db: D1Database,
  secret: string,
  userId: string,
  providerType: ProviderType,
  explicitCredentialId?: string
) {
  let query = 'SELECT id, provider_type, encrypted_key, key_iv, encryption_version, custom_endpoint FROM provider_credentials WHERE user_id = ? AND provider_type = ? AND is_active = 1';
  const params: any[] = [userId, providerType];

  if (explicitCredentialId) {
    query += ' AND id = ?';
    params.push(explicitCredentialId);
  } else {
    query += ' ORDER BY is_default DESC, created_at DESC LIMIT 1';
  }

  const cred = await db.prepare(query).bind(...params).first<any>();
  if (!cred) {
    throw new Error(`No active API key connected for provider "${providerType}". Please connect your API key in AI Providers.`);
  }

  const rawKey = await decryptCredential(
    {
      encryptedKey: cred.encrypted_key,
      keyIv: cred.key_iv,
      encryptionVersion: cred.encryption_version,
    },
    secret,
    { userId, credentialId: cred.id }
  );

  return {
    credentialId: cred.id,
    rawKey,
    customEndpoint: cred.custom_endpoint,
  };
}

/**
 * POST /chat/generate
 * Non-streaming chat completion
 */
chatRouter.post('/generate', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);

  if (!body) {
    return c.json({ success: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
  }

  const { conversationId, providerType, model, messages, systemPrompt, temperature, maxTokens, credentialId } = body;

  if (!providerType || !model || !messages || !Array.isArray(messages)) {
    return c.json({ success: false, error: { code: 'INVALID_INPUT', message: 'providerType, model, and messages array are required.' } }, 400);
  }

  try {
    const cred = await getDecryptedCredential(c.env.DB, c.env.ENCRYPTION_SECRET, user.id, providerType, credentialId);
    const adapter = registry.get(providerType);

    const latestPrompt = messages.filter((m: any) => m.role === 'user').pop()?.content || '';
    const { effectiveSystemPrompt, injectedMemoryIds } = await resolveMemoryContext(
      c.env.DB,
      user.id,
      latestPrompt,
      conversationId
    );

    const mergedSystemPrompt = [systemPrompt, effectiveSystemPrompt].filter(Boolean).join('\n\n');

    const startTime = Date.now();
    const result = await adapter.generateText(
      cred.rawKey,
      {
        model,
        messages,
        systemPrompt: mergedSystemPrompt || undefined,
        temperature,
        maxTokens,
      },
      cred.customEndpoint
    );
    const latencyMs = Date.now() - startTime;

    // Persist messages if conversationId is provided
    if (conversationId) {
      const lastUserMsg = messages[messages.length - 1];
      if (lastUserMsg && lastUserMsg.role === 'user') {
        await c.env.DB.prepare(
          `INSERT INTO messages (id, conversation_id, user_id, role, content, model, provider_type, created_at)
           VALUES (?, ?, ?, 'user', ?, ?, ?, CURRENT_TIMESTAMP)`
        ).bind(crypto.randomUUID(), conversationId, user.id, lastUserMsg.content, model, providerType).run();
      }

      await c.env.DB.prepare(
        `INSERT INTO messages (id, conversation_id, user_id, role, content, model, provider_type, token_count, created_at)
         VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?, CURRENT_TIMESTAMP)`
      ).bind(
        crypto.randomUUID(),
        conversationId,
        user.id,
        result.content,
        model,
        providerType,
        result.usage?.totalTokens || 0
      ).run();

      await c.env.DB.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
        .bind(conversationId, user.id).run();
    }

    if (result.usage) {
      await c.env.DB.prepare(
        `INSERT INTO usage_events (id, user_id, conversation_id, provider_type, model, prompt_tokens, completion_tokens, total_tokens, success, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`
      ).bind(
        crypto.randomUUID(),
        user.id,
        conversationId || null,
        providerType,
        model,
        result.usage.promptTokens,
        result.usage.completionTokens,
        result.usage.totalTokens
      ).run();
    }

    return c.json({
      success: true,
      data: {
        content: result.content,
        model: result.model,
        provider: result.provider,
        usage: result.usage,
        latencyMs,
      },
    });
  } catch (err: any) {
    return c.json({ success: false, error: { code: 'GENERATION_ERROR', message: err.message } }, 500);
  }
});

/**
 * POST /chat/stream
 * Server-Sent Events (SSE) streaming chat completion with real cancellation support
 */
chatRouter.post('/stream', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);

  if (!body) {
    return c.json({ success: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
  }

  const { conversationId, providerType, model, messages, systemPrompt, temperature, maxTokens, credentialId } = body;

  if (!providerType || !model || !messages || !Array.isArray(messages)) {
    return c.json({ success: false, error: { code: 'INVALID_INPUT', message: 'providerType, model, and messages array are required.' } }, 400);
  }

  let cred;
  try {
    cred = await getDecryptedCredential(c.env.DB, c.env.ENCRYPTION_SECRET, user.id, providerType, credentialId);
  } catch (err: any) {
    return c.json({ success: false, error: { code: 'CREDENTIAL_ERROR', message: err.message } }, 400);
  }

  const adapter = registry.get(providerType);

  // Setup abort controller for upstream cancellation
  const upstreamController = new AbortController();
  const generationKey = `user_${user.id}_conv_${conversationId || 'standalone'}`;
  localActiveGenerations.set(generationKey, upstreamController);

  // If client disconnects (network drop, tab close, or frontend AbortController),
  // abort upstream provider request immediately without relying on cross-isolate state
  c.req.raw.signal.addEventListener('abort', () => {
    upstreamController.abort();
    localActiveGenerations.delete(generationKey);
  });

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const sendEvent = async (event: StreamEvent) => {
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    } catch {
      upstreamController.abort();
    }
  };

  (async () => {
    let fullResponseText = '';
    let finalUsage: any = null;

    try {
      const latestPrompt = messages.filter((m: any) => m.role === 'user').pop()?.content || '';
      const { effectiveSystemPrompt, injectedMemoryIds } = await resolveMemoryContext(
        c.env.DB,
        user.id,
        latestPrompt,
        conversationId
      );

      const mergedSystemPrompt = [systemPrompt, effectiveSystemPrompt].filter(Boolean).join('\n\n');

      const response = await adapter.streamText(
        cred.rawKey,
        {
          model,
          messages,
          systemPrompt: mergedSystemPrompt || undefined,
          temperature,
          maxTokens,
          signal: upstreamController.signal,
        },
        async (event) => {
          if (event.type === 'content_delta' && event.content) {
            fullResponseText += event.content;
          }
          if (event.type === 'usage' && event.usage) {
            finalUsage = event.usage;
          }
          await sendEvent(event);
        },
        cred.customEndpoint
      );

      fullResponseText = response.content;
      finalUsage = response.usage || finalUsage;
    } catch (err: any) {
      if (err.name === 'AbortError' || upstreamController.signal.aborted) {
        await sendEvent({ type: 'content_delta', content: '\n\n[Generation stopped by user]' });
      } else {
        await sendEvent({ type: 'error', error: err.message || 'Stream processing failed' });
      }
    } finally {
      localActiveGenerations.delete(generationKey);

      // Persist partial or full response if any content was received before completion/abort
      if (conversationId && fullResponseText) {
        try {
          const lastUserMsg = messages[messages.length - 1];
          if (lastUserMsg && lastUserMsg.role === 'user') {
            await c.env.DB.prepare(
              `INSERT INTO messages (id, conversation_id, user_id, role, content, model, provider_type, created_at)
               VALUES (?, ?, ?, 'user', ?, ?, ?, CURRENT_TIMESTAMP)`
            ).bind(crypto.randomUUID(), conversationId, user.id, lastUserMsg.content, model, providerType).run();
          }

          await c.env.DB.prepare(
            `INSERT INTO messages (id, conversation_id, user_id, role, content, model, provider_type, token_count, created_at)
             VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?, CURRENT_TIMESTAMP)`
          ).bind(
            crypto.randomUUID(),
            conversationId,
            user.id,
            fullResponseText,
            model,
            providerType,
            finalUsage?.totalTokens || 0
          ).run();

          await c.env.DB.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
            .bind(conversationId, user.id).run();
        } catch {
          // ignore DB error during abort
        }
      }

      if (finalUsage) {
        try {
          await c.env.DB.prepare(
            `INSERT INTO usage_events (id, user_id, conversation_id, provider_type, model, prompt_tokens, completion_tokens, total_tokens, success, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`
          ).bind(
            crypto.randomUUID(),
            user.id,
            conversationId || null,
            providerType,
            model,
            finalUsage.promptTokens,
            finalUsage.completionTokens,
            finalUsage.totalTokens
          ).run();
        } catch {
          // ignore usage logging error
        }
      }

      try {
        await writer.write(encoder.encode('data: [DONE]\n\n'));
        await writer.close();
      } catch {
        // stream already closed by client abort
      }
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': c.req.header('Origin') || '*',
    },
  });
});

/**
 * POST /chat/stop
 * Explicit endpoint to cancel an active streaming generation
 */
chatRouter.post('/stop', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const conversationId = body.conversationId || 'standalone';
  const generationKey = `user_${user.id}_conv_${conversationId}`;

  const controller = localActiveGenerations.get(generationKey);
  if (controller) {
    controller.abort();
    localActiveGenerations.delete(generationKey);
    return c.json({ success: true, data: { message: 'Generation aborted successfully on local isolate.' } });
  }

  return c.json({
    success: true,
    data: {
      message: 'No active generation found on local isolate. Stream cancellation should be triggered via original request abort signal.',
    },
  });
});

/**
 * POST /chat/compare
 * Two-model simultaneous comparison with independent timeout & cancellation handling
 */
chatRouter.post('/compare', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);

  if (!body) {
    return c.json({ success: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
  }

  const { prompt, modelA, modelB } = body;
  if (!prompt || !modelA || !modelB) {
    return c.json({ success: false, error: { code: 'INVALID_INPUT', message: 'prompt, modelA, and modelB are required.' } }, 400);
  }

  const executeModel = async (config: { providerType: ProviderType; model: string; credentialId?: string }) => {
    const start = Date.now();
    // 30s independent timeout controller for comparison requests
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), 30000);

    try {
      const cred = await getDecryptedCredential(c.env.DB, c.env.ENCRYPTION_SECRET, user.id, config.providerType, config.credentialId);
      const adapter = registry.get(config.providerType);
      const res = await adapter.generateText(
        cred.rawKey,
        {
          model: config.model,
          messages: [{ role: 'user', content: prompt }],
          signal: timeoutController.signal,
        },
        cred.customEndpoint
      );
      clearTimeout(timer);
      return {
        providerType: config.providerType,
        model: config.model,
        content: res.content,
        usage: res.usage,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      clearTimeout(timer);
      return {
        providerType: config.providerType,
        model: config.model,
        content: '',
        error: err.name === 'AbortError' ? 'Model request timed out after 30s' : (err.message || 'Model execution failed'),
        latencyMs: Date.now() - start,
      };
    }
  };

  const [resA, resB] = await Promise.all([executeModel(modelA), executeModel(modelB)]);

  return c.json({
    success: true,
    data: {
      prompt,
      responseA: resA,
      responseB: resB,
    },
  });
});
