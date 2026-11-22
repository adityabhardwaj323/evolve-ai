import { Hono } from 'hono';
import { Env } from '../index';
import { hashPassword, verifyPassword } from './passwords';
import {
  createSession,
  revokeSession,
  buildSessionCookie,
  buildClearSessionCookie,
  SESSION_COOKIE_NAME,
} from './sessions';
import { checkRateLimit, recordFailedLogin, clearLoginAttempts } from './rate-limit';
import { requireAuth, AuthContext } from '../middleware/auth';

export const authRouter = new Hono<{ Bindings: Env; Variables: AuthContext }>();

/**
 * Helper to validate email format
 */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * POST /auth/register
 * Registers a new user.
 */
authRouter.post('/register', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ success: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
  }

  const { email, password, name } = body;

  if (!email || !isValidEmail(email)) {
    return c.json({ success: false, error: { code: 'INVALID_EMAIL', message: 'A valid email address is required.' } }, 400);
  }

  if (!password || typeof password !== 'string' || password.length < 8) {
    return c.json({ success: false, error: { code: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters long.' } }, 400);
  }

  const userName = (name && typeof name === 'string' && name.trim().length > 0)
    ? name.trim()
    : email.split('@')[0];

  const normEmail = email.toLowerCase().trim();

  // Check for duplicate email
  const existing = await c.env.DB
    .prepare('SELECT id FROM users WHERE email = ? LIMIT 1')
    .bind(normEmail)
    .first();

  if (existing) {
    return c.json({ success: false, error: { code: 'EMAIL_EXISTS', message: 'An account with this email already exists.' } }, 409);
  }

  // Hash password with Web Crypto PBKDF2 (100k iterations)
  const { hash, salt } = await hashPassword(password);
  const userId = crypto.randomUUID();

  // Insert user
  await c.env.DB
    .prepare(
      `INSERT INTO users (id, email, password_hash, salt, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    )
    .bind(userId, normEmail, hash, salt, userName)
    .run();

  // Initialize default user preferences
  await c.env.DB
    .prepare(
      `INSERT INTO user_preferences (id, user_id, auto_memory_extract, theme, created_at, updated_at)
       VALUES (?, ?, 1, 'system', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    )
    .bind(crypto.randomUUID(), userId)
    .run();

  // Automatically create session
  const session = await createSession(c.env.DB, userId);
  const isProd = c.env.ENVIRONMENT === 'production';
  const cookie = buildSessionCookie(session.token, session.expiresAt, isProd);

  c.header('Set-Cookie', cookie);

  return c.json({
    success: true,
    data: {
      user: {
        id: userId,
        email: normEmail,
        name: userName,
      },
      token: session.token, // Return token for optional Authorization header usage
    },
  }, 201);
});

/**
 * POST /auth/login
 * Authenticates user credentials with rate-limiting.
 */
authRouter.post('/login', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ success: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
  }

  const { email, password } = body;
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('x-forwarded-for') || '127.0.0.1';

  if (!email || !password) {
    return c.json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Email and password are required.' } }, 400);
  }

  const normEmail = email.toLowerCase().trim();

  // Check brute force rate limit
  const rateLimit = await checkRateLimit(c.env.DB, ip, normEmail);
  if (!rateLimit.allowed) {
    return c.json(
      {
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: `Too many failed login attempts. Please try again in ${rateLimit.retryAfterSeconds} seconds.`,
        },
      },
      429
    );
  }

  // Fetch user
  const user = await c.env.DB
    .prepare('SELECT id, email, password_hash, salt, name FROM users WHERE email = ? LIMIT 1')
    .bind(normEmail)
    .first<{ id: string; email: string; password_hash: string; salt: string; name: string }>();

  if (!user) {
    await recordFailedLogin(c.env.DB, ip, normEmail);
    return c.json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } }, 401);
  }

  // Verify password with constant-time comparison
  const isValid = await verifyPassword(password, user.password_hash, user.salt);
  if (!isValid) {
    await recordFailedLogin(c.env.DB, ip, normEmail);
    return c.json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } }, 401);
  }

  // Clear failed attempts upon success
  await clearLoginAttempts(c.env.DB, ip, normEmail);

  // Issue session
  const session = await createSession(c.env.DB, user.id);
  const isProd = c.env.ENVIRONMENT === 'production';
  const cookie = buildSessionCookie(session.token, session.expiresAt, isProd);

  c.header('Set-Cookie', cookie);

  return c.json({
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      token: session.token,
    },
  });
});

/**
 * POST /auth/logout
 * Revokes the current session and clears the cookie.
 */
authRouter.post('/logout', async (c) => {
  let token: string | undefined;

  const cookieHeader = c.req.header('Cookie');
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').map((s) => s.trim());
    for (const cookie of cookies) {
      if (cookie.startsWith(`${SESSION_COOKIE_NAME}=`)) {
        token = cookie.substring(SESSION_COOKIE_NAME.length + 1);
        break;
      }
    }
  }

  if (!token) {
    const authHeader = c.req.header('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    }
  }

  if (token) {
    await revokeSession(c.env.DB, token);
  }

  c.header('Set-Cookie', buildClearSessionCookie());

  return c.json({
    success: true,
    data: { message: 'Logged out successfully.' },
  });
});

/**
 * GET /auth/me
 * Returns current authenticated user details.
 */
authRouter.get('/me', requireAuth, async (c) => {
  const user = c.get('user');
  return c.json({
    success: true,
    data: { user },
  });
});
