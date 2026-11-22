import { createMiddleware } from 'hono/factory';
import { Env } from '../index';

/**
 * CSRF & Origin Verification Middleware
 * 
 * Verifies that state-changing requests (POST, PUT, PATCH, DELETE) originate
 * from explicitly allowed frontend origins.
 * 
 * Policy:
 * 1. Safe HTTP methods (GET, HEAD, OPTIONS) bypass CSRF checks.
 * 2. If 'Origin' header is present:
 *    - Must exactly match an origin in the allowed origins list.
 * 3. If 'Origin' is missing but 'Referer' is present:
 *    - Extracts referer origin; must match the allowed list.
 * 4. If BOTH 'Origin' and 'Referer' are missing:
 *    - In browser environments, modern browsers send 'Origin' on all state-changing requests.
 *    - Rejects request if it carries session cookies (mitigates cross-site form post attacks).
 *    - Allows pure non-cookie programmatic API calls (e.g. Bearer tokens from curl/scripts).
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

  const origin = c.req.header('Origin');
  const referer = c.req.header('Referer');

  let requestOrigin: string | null = null;
  if (origin) {
    requestOrigin = origin.trim();
  } else if (referer) {
    try {
      const parsedUrl = new URL(referer);
      requestOrigin = parsedUrl.origin;
    } catch {
      requestOrigin = null;
    }
  }

  // Case 1: Origin/Referer provided -> strictly validate against allowlist
  if (requestOrigin) {
    if (!allowedOrigins.includes(requestOrigin)) {
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
    return next();
  }

  // Case 2: Both Origin and Referer are absent
  // Check if cookies are attached to prevent cross-site form submissions
  const cookieHeader = c.req.header('Cookie');
  if (cookieHeader && cookieHeader.includes('evolve_session=')) {
    return c.json(
      {
        success: false,
        error: {
          code: 'CSRF_BLOCKED',
          message: 'State-changing cookie-authenticated requests require a verified Origin header.',
        },
      },
      403
    );
  }

  // Allow non-cookie authenticated CLI / script requests (e.g. Bearer auth)
  await next();
});
