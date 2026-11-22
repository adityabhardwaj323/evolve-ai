/**
 * Layered D1-Backed Rate Limiting Service
 * 
 * Implements two layers of protection:
 * Layer 1: IP-Based Rate Limiting (mitigates high-frequency network flooding/scraping)
 *   - Allows max 20 auth requests per IP per minute.
 *   - Blocks IP for progressive intervals (5 min, 15 min, 60 min).
 * 
 * Layer 2: Account-Based Rate Limiting (mitigates distributed credential stuffing)
 *   - Normalizes email (`toLowerCase().trim()`).
 *   - Allows max 5 consecutive failed attempts.
 *   - Imposes progressive backoff locks: 1st lockout: 5 mins, 2nd: 15 mins, 3rd+: 60 mins.
 *   - Atomic updates in Cloudflare D1 with monotonic counters.
 *   - Avoids permanent account lockouts (automatic expiry).
 */

export interface RateLimitCheckResult {
  allowed: boolean;
  retryAfterSeconds?: number;
  reason?: 'IP_LIMIT_EXCEEDED' | 'ACCOUNT_LOCKED';
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

  // 2. Check Account-level locks
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
           WHEN request_count + 1 >= 20 THEN datetime('now', '+5 minutes')
           ELSE blocked_until
         END`
    )
    .bind(ip)
    .run();
}

/**
 * Records a failed login attempt against the normalized account identifier.
 * Uses atomic counter increments with progressive lockout durations.
 */
export async function recordFailedLogin(
  db: D1Database,
  ip: string,
  emailNormalized: string
): Promise<void> {
  await recordIpRequest(db, ip);

  // Atomic upsert with progressive lockout
  await db
    .prepare(
      `INSERT INTO account_rate_limits (email_normalized, failed_attempts, first_failed_at, last_failed_at, locked_until)
       VALUES (?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)
       ON CONFLICT(email_normalized) DO UPDATE SET
         failed_attempts = failed_attempts + 1,
         last_failed_at = CURRENT_TIMESTAMP,
         locked_until = CASE
           WHEN failed_attempts + 1 >= 10 THEN datetime('now', '+60 minutes')
           WHEN failed_attempts + 1 >= 7 THEN datetime('now', '+15 minutes')
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
  await db
    .prepare('DELETE FROM account_rate_limits WHERE email_normalized = ?')
    .bind(emailNormalized)
    .run();
}
