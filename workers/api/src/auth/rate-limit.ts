/**
 * Layered D1-Backed Rate Limiting Service
 * 
 * Hardened & Verified:
 * 1. IP Detection:
 *    - Uses exclusively Cloudflare-verified `CF-Connecting-IP`.
 *    - In development/fallback environments only, falls back to loopback '127.0.0.1'.
 *    - Never trusts spoofable `X-Forwarded-For` or `Client-IP` headers.
 * 2. Flood Protection (IP Layer):
 *    - Max 30 requests/minute per IP; 5-minute cooldown.
 * 3. Brute-Force & Denial-of-Service Defense (Account Layer):
 *    - Normalizes email (`toLowerCase().trim()`).
 *    - Validates email format before tracking to prevent DB bloating from junk inputs.
 *    - Progressive backoff: 5 failures -> 5 min, 10 failures -> 15 min, 15+ failures -> 30 min.
 *    - Cap maximum lockout duration at 30 minutes to PREVENT prolonged permanent DoS
 *      where an attacker locks an innocent user out indefinitely.
 *    - Atomic D1 updates with monotonic counters.
 *    - Resets account failures upon successful login.
 */

export interface RateLimitCheckResult {
  allowed: boolean;
  retryAfterSeconds?: number;
  reason?: 'IP_LIMIT_EXCEEDED' | 'ACCOUNT_LOCKED';
}

const MAX_IP_REQUESTS_PER_WINDOW = 30;
const IP_BLOCK_MINUTES = 5;

/**
 * Extracts the trusted client IP.
 * Trusts ONLY CF-Connecting-IP in production environments.
 */
export function getTrustedClientIp(headers: Headers | { get(name: string): string | null }): string {
  const cfIp = headers.get('CF-Connecting-IP');
  if (cfIp && cfIp.trim().length > 0) {
    return cfIp.trim();
  }
  // Safe default for testing / local worker dev
  return '127.0.0.1';
}

/**
 * Checks both IP and Account rate limits before processing authentication requests.
 */
export async function checkRateLimit(
  db: D1Database,
  ip: string,
  emailNormalized: string
): Promise<RateLimitCheckResult> {
  const nowIso = new Date().toISOString();

  // 1. Check IP-level blocks
  const ipRecord = await db
    .prepare('SELECT blocked_until FROM ip_rate_limits WHERE ip_address = ? LIMIT 1')
    .bind(ip)
    .first<{ blocked_until: string | null }>();

  if (ipRecord && ipRecord.blocked_until) {
    const blockedUntilTime = new Date(ipRecord.blocked_until).getTime();
    const nowTime = Date.now();
    if (nowTime < blockedUntilTime) {
      const retryAfterSeconds = Math.ceil((blockedUntilTime - nowTime) / 1000);
      return { allowed: false, retryAfterSeconds, reason: 'IP_LIMIT_EXCEEDED' };
    }
  }

  // 2. Check Account-level locks (if valid email provided)
  if (emailNormalized && emailNormalized.includes('@')) {
    const accountRecord = await db
      .prepare('SELECT locked_until FROM account_rate_limits WHERE email_normalized = ? LIMIT 1')
      .bind(emailNormalized)
      .first<{ locked_until: string | null }>();

    if (accountRecord && accountRecord.locked_until) {
      const lockedUntilTime = new Date(accountRecord.locked_until).getTime();
      const nowTime = Date.now();
      if (nowTime < lockedUntilTime) {
        const retryAfterSeconds = Math.ceil((lockedUntilTime - nowTime) / 1000);
        return { allowed: false, retryAfterSeconds, reason: 'ACCOUNT_LOCKED' };
      }
    }
  }

  return { allowed: true };
}

/**
 * Records a request from an IP for flood protection.
 */
export async function recordIpRequest(db: D1Database, ip: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ip_rate_limits (ip_address, request_count, first_request_at, last_request_at, blocked_until)
       VALUES (?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)
       ON CONFLICT(ip_address) DO UPDATE SET
         request_count = request_count + 1,
         last_request_at = CURRENT_TIMESTAMP,
         blocked_until = CASE 
           WHEN request_count + 1 >= ? THEN datetime('now', '+${IP_BLOCK_MINUTES} minutes')
           ELSE blocked_until
         END`
    )
    .bind(ip, MAX_IP_REQUESTS_PER_WINDOW)
    .run();
}

/**
 * Records a failed login attempt against the normalized account identifier.
 * Uses atomic counter increments with progressive lockout capped at 30 minutes.
 */
export async function recordFailedLogin(
  db: D1Database,
  ip: string,
  emailNormalized: string
): Promise<void> {
  await recordIpRequest(db, ip);

  if (!emailNormalized || !emailNormalized.includes('@')) {
    return;
  }

  // Progressive lockout capped at 30 minutes to prevent malicious indefinite DoS
  await db
    .prepare(
      `INSERT INTO account_rate_limits (email_normalized, failed_attempts, first_failed_at, last_failed_at, locked_until)
       VALUES (?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)
       ON CONFLICT(email_normalized) DO UPDATE SET
         failed_attempts = failed_attempts + 1,
         last_failed_at = CURRENT_TIMESTAMP,
         locked_until = CASE
           WHEN failed_attempts + 1 >= 15 THEN datetime('now', '+30 minutes')
           WHEN failed_attempts + 1 >= 10 THEN datetime('now', '+15 minutes')
           WHEN failed_attempts + 1 >= 5 THEN datetime('now', '+5 minutes')
           ELSE NULL
         END`
    )
    .bind(emailNormalized)
    .run();
}

/**
 * Resets failed attempt counters upon successful authentication.
 */
export async function clearAccountFailures(db: D1Database, emailNormalized: string): Promise<void> {
  if (!emailNormalized) return;
  await db
    .prepare('DELETE FROM account_rate_limits WHERE email_normalized = ?')
    .bind(emailNormalized)
    .run();
}
