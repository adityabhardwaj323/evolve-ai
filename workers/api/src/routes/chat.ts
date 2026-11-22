import { Hono } from 'hono';
import { Env } from '../index.js';
import { requireAuth, AuthContext } from '../middleware/auth.js';
import { decryptCredential } from '../security/crypto.js';
import { ProviderRegistry } from '@evolve-ai/provider-sdk';
import { ProviderType, StreamEvent } from '@evolve-ai/shared-types';

export const chatRouter = new Hono<{ Bindings: Env; Variables: AuthContext }>();
chatRouter.use('*', requireAuth);

const registry = ProviderRegistry.getInstance();

/**
 * In-memory map of active abort controllers for stream cancellation
 * Key format: `user_{userId}_conv_{conversationId}`
 */
const activeGenerations = new Map<string, AbortController>();

/**
 * Helper to fetch and decrypt a user's active credential for a given providerType
 */
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

    const startTime = Date.now();
    const result = await adapter.generateText(
      cred.rawKey,
      {
        model,
        messages,
        systemPrompt,
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
  activeGenerations.set(generationKey, upstreamController);

  // If client disconnects, abort upstream request immediately
  c.req.raw.signal.addEventListener('abort', () => {
    upstreamController.abort();
    activeGenerations.delete(generationKey);
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
      const response = await adapter.streamText(
        cred.rawKey,
        {
          model,
          messages,
          systemPrompt,
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

      if (conversationId && fullResponseText) {
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
      }

      if (finalUsage) {
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
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || upstreamController.signal.aborted) {
        await sendEvent({ type: 'content_delta', content: '\n\n[Generation stopped by user]' });
      } else {
        await sendEvent({ type: 'error', error: err.message || 'Stream processing failed' });
      }
    } finally {
      activeGenerations.delete(generationKey);
      await writer.write(encoder.encode('data: [DONE]\n\n'));
      await writer.close();
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

  const controller = activeGenerations.get(generationKey);
  if (controller) {
    controller.abort();
    activeGenerations.delete(generationKey);
    return c.json({ success: true, data: { message: 'Generation aborted successfully.' } });
  }

  return c.json({ success: true, data: { message: 'No active generation found to abort.' } });
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
