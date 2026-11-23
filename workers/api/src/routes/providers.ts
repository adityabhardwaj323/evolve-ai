import { Hono } from 'hono';
import { Env } from '../index.js';
import { requireAuth, AuthContext } from '../middleware/auth.js';
import { decryptCredential } from '../security/crypto.js';
import { ProviderRegistry } from '@evolve-ai/provider-sdk';
import { ProviderType } from '@evolve-ai/shared-types';

export const providersRouter = new Hono<{ Bindings: Env; Variables: AuthContext }>();

// All provider endpoints require authentication
providersRouter.use('*', requireAuth);

const registry = ProviderRegistry.getInstance();

/**
 * GET /providers/supported
 * List all supported AI providers and their metadata
 */
providersRouter.get('/supported', (c) => {
  const supported = registry.listSupportedProviders();
  return c.json({
    success: true,
    data: supported,
  });
});

/**
 * GET /providers/supported/:providerId/models
 * Retrieve model catalogue for a provider (dynamic discovery when authenticated key provided, fallback to verified static)
 */
providersRouter.get('/supported/:providerId/models', async (c) => {
  const user = c.get('user');
  const providerId = c.req.param('providerId') as ProviderType;

  try {
    const adapter = registry.get(providerId);

    // Check if user has connected a credential for this provider to fetch dynamic models
    const cred = await c.env.DB
      .prepare(
        `SELECT id, encrypted_key, key_iv, encryption_version, custom_endpoint
         FROM provider_credentials
         WHERE user_id = ? AND provider_type = ? AND is_active = 1
         ORDER BY is_default DESC, created_at DESC LIMIT 1`
      )
      .bind(user.id, providerId)
      .first<any>();

    if (cred) {
      try {
        const rawKey = await decryptCredential(
          {
            encryptedKey: cred.encrypted_key,
            keyIv: cred.key_iv,
            encryptionVersion: cred.encryption_version,
          },
          c.env.ENCRYPTION_SECRET,
          { userId: user.id, credentialId: cred.id }
        );
        const dynamicModels = await adapter.listModels(rawKey, cred.custom_endpoint);
        return c.json({
          success: true,
          data: dynamicModels,
        });
      } catch {
        // Fallback to static catalog on error
      }
    }

    return c.json({
      success: true,
      data: adapter.listStaticModels(),
    });
  } catch (err: any) {
    return c.json({ success: false, error: { code: 'INVALID_PROVIDER', message: err.message } }, 400);
  }
});

/**
 * GET /providers/credentials
 * List user's connected AI provider credentials (masked keys only)
 */
providersRouter.get('/credentials', async (c) => {
  const user = c.get('user');

  const rows = await c.env.DB
    .prepare(
      `SELECT id, provider_type, label, masked_key, default_model, is_active, is_default, created_at, updated_at
       FROM provider_credentials
       WHERE user_id = ?
       ORDER BY created_at DESC`
    )
    .bind(user.id)
    .all();

  return c.json({
    success: true,
    data: rows.results || [],
  });
});

/**
 * POST /providers/credentials
 * Connects and encrypts a new provider credential using Web Crypto AES-256-GCM.
 */
providersRouter.post('/credentials', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);

  if (!body) {
    return c.json({ success: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
  }

  const { providerType, label, apiKey, defaultModel, customEndpoint, isDefault } = body;

  if (!providerType || !apiKey || !defaultModel) {
    return c.json(
      {
        success: false,
        error: { code: 'INVALID_INPUT', message: 'providerType, apiKey, and defaultModel are required.' },
      },
      400
    );
  }

  // Validate providerType exists in registry
  try {
    registry.get(providerType as ProviderType);
  } catch {
    return c.json({ success: false, error: { code: 'UNSUPPORTED_PROVIDER', message: `Unknown provider: ${providerType}` } }, 400);
  }

  const credentialId = crypto.randomUUID();
  const credentialLabel = label?.trim() || `${providerType} Connection`;

  const { encryptCredential } = await import('../security/crypto.js');
  const encrypted = await encryptCredential(apiKey, c.env.ENCRYPTION_SECRET, {
    userId: user.id,
    credentialId,
  });

  if (isDefault) {
    await c.env.DB.prepare('UPDATE provider_credentials SET is_default = 0 WHERE user_id = ?').bind(user.id).run();
  }

  await c.env.DB
    .prepare(
      `INSERT INTO provider_credentials (
        id, user_id, provider_type, label, encrypted_key, key_iv, masked_key,
        custom_endpoint, default_model, is_active, is_default, encryption_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    )
    .bind(
      credentialId,
      user.id,
      providerType,
      credentialLabel,
      encrypted.encryptedKey,
      encrypted.keyIv,
      encrypted.maskedKey,
      customEndpoint || null,
      defaultModel,
      isDefault ? 1 : 0,
      encrypted.encryptionVersion
    )
    .run();

  return c.json(
    {
      success: true,
      data: {
        id: credentialId,
        providerType,
        label: credentialLabel,
        maskedKey: encrypted.maskedKey,
        defaultModel,
        isActive: true,
        isDefault: isDefault ? true : false,
      },
    },
    201
  );
});

/**
 * POST /providers/credentials/:id/test
 * Explicitly tests a connected provider API credential on user demand.
 */
providersRouter.post('/credentials/:id/test', async (c) => {
  const user = c.get('user');
  const credentialId = c.req.param('id');

  const cred = await c.env.DB
    .prepare(
      `SELECT id, provider_type, encrypted_key, key_iv, encryption_version, custom_endpoint
       FROM provider_credentials
       WHERE id = ? AND user_id = ?`
    )
    .bind(credentialId, user.id)
    .first<any>();

  if (!cred) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Credential not found or unauthorized.' } }, 404);
  }

  try {
    const rawKey = await decryptCredential(
      {
        encryptedKey: cred.encrypted_key,
        keyIv: cred.key_iv,
        encryptionVersion: cred.encryption_version,
      },
      c.env.ENCRYPTION_SECRET,
      { userId: user.id, credentialId: cred.id }
    );

    const adapter = registry.get(cred.provider_type);
    const testResult = await adapter.validateCredentials(rawKey, cred.custom_endpoint);

    if (!testResult.valid) {
      return c.json({ success: false, error: { code: 'VALIDATION_FAILED', message: testResult.error } }, 400);
    }

    return c.json({
      success: true,
      data: { status: 'connected', provider: cred.provider_type, message: 'Provider API key validated successfully.' },
    });
  } catch (err: any) {
    return c.json({ success: false, error: { code: 'TEST_ERROR', message: err.message } }, 500);
  }
});

/**
 * In-memory guard to prevent duplicate concurrent smoke test submissions
 * Key: `user_{userId}_cred_{credentialId}`
 */
const activeSmokeTests = new Set<string>();

/**
 * POST /providers/credentials/:id/smoke-test
 * User-triggered: "Provider Connection & Generation Test — May Incur API Charges"
 * Selectable operations:
 * - 'auth': Lightweight model discovery (no generation tokens charged by provider)
 * - 'generation': Single minimal text generation (incurs minimal API tokens)
 * - 'streaming': Minimal streaming token verification (incurs minimal API tokens)
 */
providersRouter.post('/credentials/:id/smoke-test', async (c) => {
  const user = c.get('user');
  const credentialId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));

  // Duplicate submission protection
  const testKey = `user_${user.id}_cred_${credentialId}`;
  if (activeSmokeTests.has(testKey)) {
    return c.json({
      success: false,
      error: { code: 'TEST_IN_PROGRESS', message: 'A test is already running for this credential. Please wait for it to complete.' },
    }, 429);
  }

  activeSmokeTests.add(testKey);

  try {
    const cred = await c.env.DB
      .prepare(
        `SELECT id, provider_type, default_model, encrypted_key, key_iv, encryption_version, custom_endpoint
         FROM provider_credentials
         WHERE id = ? AND user_id = ?`
      )
      .bind(credentialId, user.id)
      .first<any>();

    if (!cred) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Credential not found or unauthorized.' } }, 404);
    }

    const rawKey = await decryptCredential(
      {
        encryptedKey: cred.encrypted_key,
        keyIv: cred.key_iv,
        encryptionVersion: cred.encryption_version,
      },
      c.env.ENCRYPTION_SECRET,
      { userId: user.id, credentialId: cred.id }
    );

    const adapter = registry.get(cred.provider_type);

    // Operations to perform (default to auth, generation, streaming if none provided)
    const ops: string[] = Array.isArray(body.operations) && body.operations.length > 0
      ? body.operations
      : ['auth', 'generation', 'streaming'];

    const testResults: Record<string, any> = {
      provider: cred.provider_type,
      model: cred.default_model,
      testName: 'Provider Connection & Generation Test — May Incur API Charges',
      costWarningAcknowledged: true,
      timestamp: new Date().toISOString(),
    };

    // 1. Auth & Model Discovery Check
    if (ops.includes('auth')) {
      const authRes = await adapter.validateCredentials(rawKey, cred.custom_endpoint);
      if (!authRes.valid) {
        return c.json({ success: false, error: { code: 'AUTH_FAILED', message: authRes.error } }, 400);
      }
      testResults.authStatus = 'passed';
    }

    // 2. Text Generation Check (Minimal tokens: 5-10 max)
    if (ops.includes('generation')) {
      const genRes = await adapter.generateText(
        rawKey,
        {
          model: cred.default_model,
          messages: [{ role: 'user', content: 'Respond with the word "pong".' }],
          maxTokens: 10,
          temperature: 0,
        },
        cred.custom_endpoint
      );
      testResults.generationStatus = 'passed';
      testResults.sampleResponse = genRes.content;
      testResults.tokensReported = genRes.usage?.totalTokens || 0;
    }

    // 3. Streaming Generation Check (Minimal tokens)
    if (ops.includes('streaming')) {
      let streamChunks = 0;
      await adapter.streamText(
        rawKey,
        {
          model: cred.default_model,
          messages: [{ role: 'user', content: 'Say "hello world".' }],
          maxTokens: 10,
          temperature: 0,
        },
        (event) => {
          if (event.type === 'content_delta') streamChunks++;
        },
        cred.custom_endpoint
      );
      testResults.streamingStatus = streamChunks > 0 ? 'passed' : 'verified_buffered';
    }

    return c.json({
      success: true,
      data: testResults,
    });
  } catch (err: any) {
    return c.json({ success: false, error: { code: 'SMOKE_TEST_FAILED', message: err.message } }, 500);
  } finally {
    activeSmokeTests.delete(testKey);
  }
});

/**
 * PATCH /providers/credentials/:id
 * Updates label, default model, or default status of a credential.
 */
providersRouter.patch('/credentials/:id', async (c) => {
  const user = c.get('user');
  const credentialId = c.req.param('id');
  const body = await c.req.json().catch(() => null);

  if (!body) {
    return c.json({ success: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
  }

  const { label, defaultModel, isDefault } = body;

  if (isDefault) {
    await c.env.DB.prepare('UPDATE provider_credentials SET is_default = 0 WHERE user_id = ?').bind(user.id).run();
  }

  const res = await c.env.DB
    .prepare(
      `UPDATE provider_credentials 
       SET label = COALESCE(?, label),
           default_model = COALESCE(?, default_model),
           is_default = COALESCE(?, is_default),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`
    )
    .bind(label || null, defaultModel || null, isDefault !== undefined ? (isDefault ? 1 : 0) : null, credentialId, user.id)
    .run();

  if ((res.meta.changes ?? 0) === 0) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Credential not found.' } }, 404);
  }

  return c.json({ success: true, data: { message: 'Credential updated successfully.' } });
});

/**
 * DELETE /providers/credentials/:id
 * Deletes a provider credential.
 */
providersRouter.delete('/credentials/:id', async (c) => {
  const user = c.get('user');
  const credentialId = c.req.param('id');

  const res = await c.env.DB
    .prepare('DELETE FROM provider_credentials WHERE id = ? AND user_id = ?')
    .bind(credentialId, user.id)
    .run();

  if ((res.meta.changes ?? 0) === 0) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Credential not found or unauthorized.' } }, 404);
  }

  return c.json({ success: true, data: { message: 'Provider credential disconnected successfully.' } });
});
