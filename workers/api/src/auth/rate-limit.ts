/**
 * Lightweight D1-backed rate limiting for login attempts
 * Prevents brute force credential stuffing without third-party paid services.
 */

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export async function checkRateLimit(
  db: D1Database,
  ip: string,
  email: string
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  const nowIso = new Date().toISOString();

  // Find existing attempt record
  const record = await db
    .prepare(
      `SELECT attempt_count, locked_until 
       FROM login_attempts 
       WHERE ip_address = ? AND email = ? 
       LIMIT 1`
    )
    .bind(ip, email.toLowerCase())
    .first<{ attempt_count: number; locked_until: string | null }>();

  if (record && record.locked_until) {
    const lockedUntilTime = new Date(record.locked_until).getTime();
    const nowTime = Date.now();
    if (nowTime < lockedUntilTime) {
      const retryAfterSeconds = Math.ceil((lockedUntilTime - nowTime) / 1000);
      return { allowed: false, retryAfterSeconds };
    }
  }

  return { allowed: true };
}

export async function recordFailedLogin(db: D1Database, ip: string, email: string): Promise<void> {
  const normEmail = email.toLowerCase();
  const existing = await db
    .prepare(
      `SELECT id, attempt_count 
       FROM login_attempts 
       WHERE ip_address = ? AND email = ? 
       LIMIT 1`
    )
    .bind(ip, normEmail)
    .first<{ id: string; attempt_count: number }>();

  if (!existing) {
    const id = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO login_attempts (id, ip_address, email, attempt_count, last_attempt)
         VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)`
      )
      .bind(id, ip, normEmail)
      .run();
  } else {
    const newCount = existing.attempt_count + 1;
    let lockedUntil: string | null = null;
    if (newCount >= MAX_ATTEMPTS) {
      const lockDate = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
      lockedUntil = lockDate.toISOString();
    }

    await db
      .prepare(
        `UPDATE login_attempts 
         SET attempt_count = ?, last_attempt = CURRENT_TIMESTAMP, locked_until = ?
         WHERE id = ?`
      )
      .bind(newCount, lockedUntil, existing.id)
      .run();
  }
}

export async function clearLoginAttempts(db: D1Database, ip: string, email: string): Promise<void> {
  await db
    .prepare(`DELETE FROM login_attempts WHERE ip_address = ? AND email = ?`)
    .bind(ip, email.toLowerCase())
    .run();
}
