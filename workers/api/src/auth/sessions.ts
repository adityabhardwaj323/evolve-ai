/**
 * Session Security & Management Service
 * 
 * - Opaque 32-byte cryptographically random session token.
 * - Base64url encoding for URL & Cookie safety without delimiter conflicts.
 * - Stores ONLY the SHA-256 hash of the token in D1 (`token_hash`).
 * - Delivered to the client via HttpOnly, Secure, SameSite=Lax (or Strict) cookie.
 * - Raw token is never stored in D1 and never stored in localStorage.
 * - Session expiration check and active invalidation on logout.
 */

export interface SessionInfo {
  id: string;
  userId: string;
  expiresAt: string;
}

export const SESSION_COOKIE_NAME = 'evolve_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Base64url encoding for binary arrays (RFC 4648).
 */
export function bufferToBase64Url(buffer: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < buffer.byteLength; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Generates an opaque cryptographically random 32-byte session token encoded in base64url.
 */
export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bufferToBase64Url(bytes);
}

/**
 * Computes a SHA-256 hash of the session token for secure database storage and comparison.
 */
export async function hashSessionToken(token: string): Promise<string> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(token));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Creates a new session in D1.
 */
export async function createSession(
  db: D1Database,
  userId: string
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const rawToken = generateSessionToken();
  const tokenHash = await hashSessionToken(rawToken);
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`
    )
    .bind(sessionId, userId, tokenHash, expiresAt.toISOString())
    .run();

  return {
    token: rawToken,
    sessionId,
    expiresAt,
  };
}

/**
 * Validates a session token against D1.
 */
export async function validateSession(
  db: D1Database,
  rawToken: string
): Promise<{ user: { id: string; email: string; name: string }; sessionId: string } | null> {
  if (!rawToken || rawToken.length < 16) {
    return null;
  }

  const tokenHash = await hashSessionToken(rawToken);
  const nowIso = new Date().toISOString();

  const query = `
    SELECT 
      s.id as session_id,
      s.expires_at,
      u.id as user_id,
      u.email,
      u.name
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token_hash = ? AND s.expires_at > ?
    LIMIT 1
  `;

  const result = await db.prepare(query).bind(tokenHash, nowIso).first<{
    session_id: string;
    expires_at: string;
    user_id: string;
    email: string;
    name: string;
  }>();

  if (!result) {
    return null;
  }

  return {
    sessionId: result.session_id,
    user: {
      id: result.user_id,
      email: result.email,
      name: result.name,
    },
  };
}

/**
 * Revokes a session in D1.
 */
export async function revokeSession(db: D1Database, rawToken: string): Promise<boolean> {
  if (!rawToken) return false;
  const tokenHash = await hashSessionToken(rawToken);
  const res = await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
  return (res.meta.changes ?? 0) > 0;
}

/**
 * Builds the Set-Cookie header string with HttpOnly, Secure, SameSite=Lax.
 */
export function buildSessionCookie(token: string, expiresAt: Date, isProduction: boolean): string {
  const secureFlag = isProduction ? 'Secure;' : '';
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; Expires=${expiresAt.toUTCString()}; HttpOnly; ${secureFlag} SameSite=Lax`;
}

/**
 * Builds the deletion cookie header string.
 */
export function buildClearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax`;
}
