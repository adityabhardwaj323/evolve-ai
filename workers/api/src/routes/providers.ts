import { Hono } from 'hono';
import { Env } from '../index';
import { requireAuth, AuthContext } from '../middleware/auth';
import { encryptCredential, maskApiKey } from '../security/crypto';

export const providersRouter = new Hono<{ Bindings: Env; Variables: AuthContext }>();

// All provider endpoints strictly require verified authentication
providersRouter.use('*', requireAuth);

/**
 * GET /providers
 * List the current user's connected AI provider credentials (masked keys only).
 * Strictly filtered by authenticated user id.
 */
providersRouter.get('/', async (c) => {
  const user = c.get('user');

  const rows = await c.env.DB
    .prepare(
      `SELECT id, provider_type, label, masked_key, default_model, is_active, created_at, updated_at
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
 * POST /providers/connect
 * Encrypts and stores a new BYOK API credential.
 * User ID is strictly derived from verified session.
 */
providersRouter.post('/connect', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);

  if (!body) {
    return c.json({ success: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
  }

  const { providerType, label, apiKey, defaultModel, customEndpoint } = body;

  if (!providerType || !apiKey || !defaultModel) {
    return c.json(
      {
        success: false,
        error: { code: 'INVALID_INPUT', message: 'providerType, apiKey, and defaultModel are required.' },
      },
      400
    );
  }

  const credentialId = crypto.randomUUID();
  const credentialLabel = label?.trim() || `${providerType} Connection`;

  // Encrypt with Web Crypto AES-256-GCM + unique IV + AAD (user_id + credential_id + version)
  const encrypted = await encryptCredential(apiKey, c.env.ENCRYPTION_SECRET, {
    userId: user.id,
    credentialId,
  });

  await c.env.DB
    .prepare(
      `INSERT INTO provider_credentials (
        id, user_id, provider_type, label, encrypted_key, key_iv, masked_key,
        custom_endpoint, default_model, is_active, encryption_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
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
      },
    },
    201
  );
});

/**
 * DELETE /providers/:id
 * Deletes a provider credential. Strictly checks ownership (WHERE id = ? AND user_id = ?).
 */
providersRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  const credentialId = c.req.param('id');

  const res = await c.env.DB
    .prepare('DELETE FROM provider_credentials WHERE id = ? AND user_id = ?')
    .bind(credentialId, user.id)
    .run();

  if ((res.meta.changes ?? 0) === 0) {
    return c.json(
      {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Credential not found or unauthorized.' },
      },
      404
    );
  }

  return c.json({
    success: true,
    data: { message: 'Provider credential disconnected successfully.' },
  });
});
