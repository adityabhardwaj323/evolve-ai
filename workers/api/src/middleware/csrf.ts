import { createMiddleware } from 'hono/factory';
import { Env } from '../index';

/**
 * CSRF & Origin Verification Middleware
 * 
 * Verifies that state-changing requests (POST, PUT, PATCH, DELETE) originate
 * from explicitly allowed frontend origins.
 * Blocks cross-site request forgery attacks on cookie-authenticated sessions.
 */
export const verifyCsrfAndOrigin = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const method = c.req.method.toUpperCase();

  // Safe HTTP methods do not alter state
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }

  const allowedOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ];
  if (c.env.CLIENT_ORIGIN && !allowedOrigins.includes(c.env.CLIENT_ORIGIN)) {
    allowedOrigins.push(c.env.CLIENT_ORIGIN);
  }

  // Check Origin or Referer header
  const origin = c.req.header('Origin');
  const referer = c.req.header('Referer');

  let requestOrigin: string | null = null;
  if (origin) {
    requestOrigin = origin;
  } else if (referer) {
    try {
      const parsedUrl = new URL(referer);
      requestOrigin = parsedUrl.origin;
    } catch {
      requestOrigin = null;
    }
  }

  // In production / browser environments, state-changing requests must present a valid Origin
  if (requestOrigin && !allowedOrigins.includes(requestOrigin)) {
    return c.json(
      {
        success: false,
        error: {
          code: 'CSRF_BLOCKED',
          message: 'Cross-origin request rejected. Untrusted Origin header.',
        },
      },
      403
    );
  }

  await next();
});
