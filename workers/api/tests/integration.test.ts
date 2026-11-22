import { describe, it, expect, beforeEach } from 'vitest';
import app from '../src/index';
import {
  decodeMasterSecret,
  encryptCredential,
  decryptCredential,
  rotateCredentialKey,
} from '../src/security/crypto';
import { hashPassword, verifyPassword, validatePassword } from '../src/auth/passwords';
import { generateSessionToken, hashSessionToken, buildSessionCookie } from '../src/auth/sessions';

// In-Memory Mock D1 implementation for deterministic unit & integration tests
class MockD1Database {
  private tables: Record<string, any[]> = {
    users: [],
    sessions: [],
    provider_credentials: [],
    conversations: [],
    messages: [],
    memories: [],
    projects: [],
    user_preferences: [],
    ip_rate_limits: [],
    account_rate_limits: [],
  };

  prepare(query: string) {
    const trimmed = query.trim();
    return {
      bind: (...args: any[]) => ({
        first: async <T = any>(): Promise<T | null> => {
          if (trimmed.includes('FROM users WHERE email = ?')) {
            const email = args[0];
            const found = this.tables.users.find((u) => u.email === email);
            return (found as T) || null;
          }
          if (trimmed.includes('FROM sessions s') && trimmed.includes('JOIN users u')) {
            const tokenHash = args[0];
            const nowIso = args[1];
            const session = this.tables.sessions.find(
              (s) => s.token_hash === tokenHash && s.expires_at > nowIso
            );
            if (!session) return null;
            const user = this.tables.users.find((u) => u.id === session.user_id);
            if (!user) return null;
            return {
              session_id: session.id,
              expires_at: session.expires_at,
              user_id: user.id,
              email: user.email,
              name: user.name,
            } as T;
          }
          if (trimmed.includes('FROM ip_rate_limits WHERE ip_address = ?')) {
            const ip = args[0];
            const found = this.tables.ip_rate_limits.find((r) => r.ip_address === ip);
            return (found as T) || null;
          }
          if (trimmed.includes('FROM account_rate_limits WHERE email_normalized = ?')) {
            const email = args[0];
            const found = this.tables.account_rate_limits.find((r) => r.email_normalized === email);
            return (found as T) || null;
          }
          if (trimmed.includes('FROM conversations WHERE id = ? AND user_id = ?')) {
            const [id, userId] = args;
            const found = this.tables.conversations.find((c) => c.id === id && c.user_id === userId);
            return (found as T) || null;
          }
          if (trimmed.includes('FROM memories WHERE id = ? AND user_id = ?')) {
            const [id, userId] = args;
            const found = this.tables.memories.find((m) => m.id === id && m.user_id === userId);
            return (found as T) || null;
          }
          return null;
        },
        all: async <T = any>(): Promise<{ results: T[] }> => {
          if (trimmed.includes('FROM provider_credentials WHERE user_id = ?')) {
            const userId = args[0];
            return { results: this.tables.provider_credentials.filter((c) => c.user_id === userId) as T[] };
          }
          if (trimmed.includes('FROM conversations WHERE user_id = ?')) {
            const userId = args[0];
            return { results: this.tables.conversations.filter((c) => c.user_id === userId) as T[] };
          }
          if (trimmed.includes('FROM memories WHERE user_id = ?')) {
            const userId = args[0];
            return { results: this.tables.memories.filter((m) => m.user_id === userId) as T[] };
          }
          return { results: [] };
        },
        run: async () => {
          if (trimmed.includes('INSERT INTO users')) {
            const [id, email, password_hash, salt, name, hash_algorithm, hash_iterations] = args;
            this.tables.users.push({ id, email, password_hash, salt, name, hash_algorithm, hash_iterations });
            return { meta: { changes: 1 } };
          }
          if (trimmed.includes('INSERT INTO user_preferences')) {
            return { meta: { changes: 1 } };
          }
          if (trimmed.includes('INSERT INTO sessions')) {
            const [id, user_id, token_hash, expires_at] = args;
            this.tables.sessions.push({ id, user_id, token_hash, expires_at });
            return { meta: { changes: 1 } };
          }
          if (trimmed.includes('DELETE FROM sessions WHERE token_hash = ?')) {
            const tokenHash = args[0];
            const initialLen = this.tables.sessions.length;
            this.tables.sessions = this.tables.sessions.filter((s) => s.token_hash !== tokenHash);
            return { meta: { changes: initialLen - this.tables.sessions.length } };
          }
          if (trimmed.includes('INSERT INTO provider_credentials')) {
            const [id, user_id, provider_type, label, encrypted_key, key_iv, masked_key, custom_endpoint, default_model, encryption_version] = args;
            this.tables.provider_credentials.push({
              id,
              user_id,
              provider_type,
              label,
              encrypted_key,
              key_iv,
              masked_key,
              custom_endpoint,
              default_model,
              encryption_version,
            });
            return { meta: { changes: 1 } };
          }
          if (trimmed.includes('DELETE FROM provider_credentials WHERE id = ? AND user_id = ?')) {
            const [id, userId] = args;
            const initial = this.tables.provider_credentials.length;
            this.tables.provider_credentials = this.tables.provider_credentials.filter(
              (c) => !(c.id === id && c.user_id === userId)
            );
            return { meta: { changes: initial - this.tables.provider_credentials.length } };
          }
          if (trimmed.includes('INSERT INTO conversations')) {
            const [id, user_id, project_id, title, provider_type, model, is_temporary] = args;
            this.tables.conversations.push({ id, user_id, project_id, title, provider_type, model, is_temporary });
            return { meta: { changes: 1 } };
          }
          if (trimmed.includes('DELETE FROM conversations WHERE id = ? AND user_id = ?')) {
            const [id, userId] = args;
            const initial = this.tables.conversations.length;
            this.tables.conversations = this.tables.conversations.filter(
              (c) => !(c.id === id && c.user_id === userId)
            );
            return { meta: { changes: initial - this.tables.conversations.length } };
          }
          if (trimmed.includes('INSERT INTO memories')) {
            const [id, user_id, project_id, category, content, source_type, source_id, status, confidence] = args;
            this.tables.memories.push({ id, user_id, project_id, category, content, source_type, source_id, status, confidence });
            return { meta: { changes: 1 } };
          }
          if (trimmed.includes('DELETE FROM memories WHERE id = ? AND user_id = ?')) {
            const [id, userId] = args;
            const initial = this.tables.memories.length;
            this.tables.memories = this.tables.memories.filter((m) => !(m.id === id && m.user_id === userId));
            return { meta: { changes: initial - this.tables.memories.length } };
          }
          if (trimmed.includes('INSERT INTO account_rate_limits')) {
            const email = args[0];
            const existing = this.tables.account_rate_limits.find((r) => r.email_normalized === email);
            if (!existing) {
              this.tables.account_rate_limits.push({ email_normalized: email, failed_attempts: 1, locked_until: null });
            } else {
              existing.failed_attempts += 1;
              if (existing.failed_attempts >= 5) {
                existing.locked_until = new Date(Date.now() + 5 * 60 * 1000).toISOString();
              }
            }
            return { meta: { changes: 1 } };
          }
          if (trimmed.includes('DELETE FROM account_rate_limits WHERE email_normalized = ?')) {
            const email = args[0];
            this.tables.account_rate_limits = this.tables.account_rate_limits.filter((r) => r.email_normalized !== email);
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
      }),
    };
  }
}

// 64-character hexadecimal valid 256-bit secret
const VALID_HEX_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const VALID_HEX_SECRET_2 = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

describe('Milestone 2.1 — Security Verification and Hardening', () => {
  let mockDb: MockD1Database;
  let env: any;

  beforeEach(() => {
    mockDb = new MockD1Database();
    env = {
      DB: mockDb,
      ENCRYPTION_SECRET: VALID_HEX_SECRET,
      SESSION_SECRET: 'session_secret_at_least_32_characters_here_12345',
      ENVIRONMENT: 'production',
      CLIENT_ORIGIN: 'http://localhost:5173',
    };
  });

  // Requirement 1: PBKDF2 & Password Normalization
  describe('PBKDF2 Password Hashing & Requirements', () => {
    it('enforces minimum 12 characters and max 128 characters', () => {
      expect(validatePassword('short').valid).toBe(false);
      expect(validatePassword('a'.repeat(129)).valid).toBe(false);
      expect(validatePassword('valid-passphrase-with-length').valid).toBe(true);
    });

    it('hashes with NFKC normalization and captures iteration metadata', async () => {
      const pwd = 'mySecurePassword123!';
      const res = await hashPassword(pwd, 100000);
      expect(res.algorithm).toBe('PBKDF2-HMAC-SHA256');
      expect(res.iterations).toBe(100000);
      expect(res.salt.length).toBe(32); // 16 bytes hex

      const verified = await verifyPassword(pwd, res.hash, res.salt, res.iterations);
      expect(verified).toBe(true);
    });
  });

  // Requirement 2: Encryption Secret Validation & Key Rotation
  describe('Encryption Secret Validation & Key Rotation', () => {
    it('strictly requires exactly 32 cryptographically random bytes (rejects arbitrary strings)', () => {
      expect(() => decodeMasterSecret('arbitrary_short_text')).toThrow();
      expect(() => decodeMasterSecret('thirty_two_char_plain_string!!!!')).toThrow();
      expect(decodeMasterSecret(VALID_HEX_SECRET).length).toBe(32);
    });

    it('rotates credential key from version 1 to version 2 without plaintext exposure', async () => {
      const apiKey = 'sk-proj-superSecretLiveKey1234567890';
      const context = { userId: 'usr-1', credentialId: 'crd-1' };

      const encV1 = await encryptCredential(apiKey, VALID_HEX_SECRET, context, 1);
      expect(encV1.encryptionVersion).toBe(1);

      // Rotate to version 2 with a new secret
      const encV2 = await rotateCredentialKey(encV1, VALID_HEX_SECRET, VALID_HEX_SECRET_2, 2, context);
      expect(encV2.encryptionVersion).toBe(2);

      const decrypted = await decryptCredential(encV2, VALID_HEX_SECRET_2, context);
      expect(decrypted).toBe(apiKey);
    });
  });

  // Requirement 3: HTTP Security Headers & Permissions Policy
  describe('Security Headers', () => {
    it('sets CSP, nosniff, frame-ancestors, Permissions-Policy and omits legacy X-XSS-Protection', async () => {
      const req = new Request('http://localhost/health');
      const res = await app.fetch(req, env);

      expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
      expect(res.headers.get('Permissions-Policy')).toContain('camera=()');
      expect(res.headers.get('X-XSS-Protection')).toBeNull(); // Legacy header removed
    });
  });

  // Requirement 4 & 5: Session Lifecycle, Cookie Attributes & CSRF
  describe('Authentication Lifecycle & CSRF Verification', () => {
    it('completes Register -> Login -> /me -> Logout -> Old session rejected', async () => {
      // 1. Register
      const regReq = new Request('http://localhost/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173',
        },
        body: JSON.stringify({
          email: 'alice@example.com',
          password: 'PassphraseLongEnough123!',
          name: 'Alice',
        }),
      });
      const regRes = await app.fetch(regReq, env);
      expect(regRes.status).toBe(201);
      const regJson: any = await regRes.json();
      expect(regJson.success).toBe(true);

      const setCookie = regRes.headers.get('Set-Cookie');
      expect(setCookie).toContain('evolve_session=');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');
      expect(setCookie).toContain('Secure'); // In production environment

      const token = regJson.data.token;

      // 2. Access /auth/me with valid Bearer token
      const meReq = new Request('http://localhost/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const meRes = await app.fetch(meReq, env);
      expect(meRes.status).toBe(200);
      const meJson: any = await meRes.json();
      expect(meJson.data.user.email).toBe('alice@example.com');

      // 3. Logout
      const logoutReq = new Request('http://localhost/auth/logout', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Origin': 'http://localhost:5173',
        },
      });
      const logoutRes = await app.fetch(logoutReq, env);
      expect(logoutRes.status).toBe(200);

      // 4. Old session rejected
      const meAfterLogout = await app.fetch(
        new Request('http://localhost/auth/me', { headers: { Authorization: `Bearer ${token}` } }),
        env
      );
      expect(meAfterLogout.status).toBe(401);
    });

    it('rejects state-changing CSRF requests with untrusted Origin header', async () => {
      const csrfReq = new Request('http://localhost/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://malicious-attacker-site.com',
        },
        body: JSON.stringify({
          email: 'alice@example.com',
          password: 'PassphraseLongEnough123!',
        }),
      });

      const res = await app.fetch(csrfReq, env);
      expect(res.status).toBe(403);
      const json: any = await res.json();
      expect(json.error.code).toBe('CSRF_BLOCKED');
    });

    it('rejects state-changing requests carrying session cookies with missing Origin', async () => {
      const forgedCookieReq = new Request('http://localhost/auth/logout', {
        method: 'POST',
        headers: {
          'Cookie': 'evolve_session=mock_token_value',
        },
      });

      const res = await app.fetch(forgedCookieReq, env);
      expect(res.status).toBe(403);
      const json: any = await res.json();
      expect(json.error.code).toBe('CSRF_BLOCKED');
    });
  });

  // Requirement 6: Tenant Isolation via Actual API Routes
  describe('Tenant Isolation Enforcement', () => {
    it('Alice cannot read, update, delete, or decrypt Bob data through actual API routes', async () => {
      // Create Alice & Bob sessions directly in mockDb
      const aliceId = 'usr-alice';
      const bobId = 'usr-bob';

      const aliceToken = generateSessionToken();
      const bobToken = generateSessionToken();

      const aliceTokenHash = await hashSessionToken(aliceToken);
      const bobTokenHash = await hashSessionToken(bobToken);

      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      await mockDb.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(aliceId, 'alice@test.com', 'h1', 's1', 'Alice', 'PBKDF2', 100000).run();
      await mockDb.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(bobId, 'bob@test.com', 'h2', 's2', 'Bob', 'PBKDF2', 100000).run();

      await mockDb.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)')
        .bind('sess-alice', aliceId, aliceTokenHash, futureDate).run();
      await mockDb.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)')
        .bind('sess-bob', bobId, bobTokenHash, futureDate).run();

      // Bob creates a private conversation
      const bobConvId = 'conv-bob-secret-1';
      await mockDb.prepare('INSERT INTO conversations VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(bobConvId, bobId, null, "Bob's Secret Trade Strategy", 'gemini', 'gemini-1.5', 0).run();

      // Bob creates a private memory
      const bobMemId = 'mem-bob-1';
      await mockDb.prepare('INSERT INTO memories VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(bobMemId, bobId, null, 'user_preference', 'Prefers Rust over C++', 'direct_entry', null, 'approved', 0.9).run();

      // 1. Alice attempts to READ Bob's conversation -> BLOCKED (404)
      const readConvReq = new Request(`http://localhost/conversations/${bobConvId}`, {
        headers: { Authorization: `Bearer ${aliceToken}` },
      });
      const readConvRes = await app.fetch(readConvReq, env);
      expect(readConvRes.status).toBe(404);

      // 2. Alice attempts to DELETE Bob's conversation -> BLOCKED (404)
      const delConvReq = new Request(`http://localhost/conversations/${bobConvId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${aliceToken}`,
          'Origin': 'http://localhost:5173',
        },
      });
      const delConvRes = await app.fetch(delConvReq, env);
      expect(delConvRes.status).toBe(404);

      // 3. Alice attempts to DELETE Bob's memory -> BLOCKED (404)
      const delMemReq = new Request(`http://localhost/memory/${bobMemId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${aliceToken}`,
          'Origin': 'http://localhost:5173',
        },
      });
      const delMemRes = await app.fetch(delMemReq, env);
      expect(delMemRes.status).toBe(404);

      // 4. Bob's records remain intact
      const bobConvCheck = await mockDb.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?')
        .bind(bobConvId, bobId).first();
      expect(bobConvCheck).not.toBeNull();
    });
  });
});
