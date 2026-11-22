import { createMiddleware } from 'hono/factory';
import { validateSession, SESSION_COOKIE_NAME } from '../auth/sessions';
import { Env } from '../index';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
}

export type AuthContext = {
  user: AuthenticatedUser;
  sessionId: string;
};

/**
 * Authentication Middleware
 * 
 * - Extracts session token strictly from the secure HttpOnly cookie or Bearer header.
 * - Validates the SHA-256 hash in D1 against active unexpired sessions.
 * - Injects verified user context into Hono context: `c.get('user')`.
 * - Throws 401 UNAUTHORIZED if invalid or absent.
 */
export const requireAuth = createMiddleware<{
  Bindings: Env;
  Variables: AuthContext;
}>(async (c, next) => {
  let token: string | undefined;

  // 1. Try extracting from Cookie header
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

  // 2. Fallback to Authorization: Bearer <token>
  if (!token) {
    const authHeader = c.req.header('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    }
  }

  if (!token) {
    return c.json(
      {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required. Please log in.',
        },
      },
      401
    );
  }

  const sessionData = await validateSession(c.env.DB, token);
  if (!sessionData) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_SESSION',
          message: 'Session has expired or is invalid. Please log in again.',
        },
      },
      401
    );
  }

  // Set verified user in context for downstream handlers
  c.set('user', sessionData.user);
  c.set('sessionId', sessionData.sessionId);

  await next();
});
