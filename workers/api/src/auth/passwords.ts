/**
 * Web Crypto Password Hashing Service
 * 
 * - Algorithm: PBKDF2 with HMAC-SHA-256.
 * - Iterations: 100,000 (default, balance of security and Cloudflare Workers 10ms CPU limit).
 * - Unicode NFKC normalization for passwords before hashing.
 * - Minimum 12 characters, up to 128 characters.
 * - Stores algorithm and iteration count metadata to support future seamless upgrades.
 * - Constant-time comparison for verification.
 */

export const DEFAULT_PBKDF2_ITERATIONS = 100000;
export const HASH_ALGORITHM_IDENTIFIER = 'PBKDF2-HMAC-SHA256';
const SALT_BYTES = 16;
const KEY_BYTES = 32; // 256-bit derived key

export interface HashResult {
  hash: string;       // hex encoded
  salt: string;       // hex encoded
  algorithm: string;  // e.g. 'PBKDF2-HMAC-SHA256'
  iterations: number; // e.g. 100000
}

/**
 * Normalizes a password string using Unicode NFKC normalization.
 */
export function normalizePassword(password: string): string {
  if (typeof password !== 'string') {
    throw new Error('Password must be a string.');
  }
  return password.normalize('NFKC');
}

/**
 * Validates password rules:
 * - Minimum 12 characters.
 * - Maximum 128 characters.
 * - No arbitrary mandatory character class constraints (avoids user frustration and encourages long passphrases).
 */
export function validatePassword(password: string): { valid: boolean; error?: string } {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required.' };
  }
  const normalized = normalizePassword(password);
  if (normalized.length < 12) {
    return { valid: false, error: 'Password must be at least 12 characters long.' };
  }
  if (normalized.length > 128) {
    return { valid: false, error: 'Password must not exceed 128 characters.' };
  }
  return { valid: true };
}

/**
 * Hashes a password using PBKDF2-HMAC-SHA256 with cryptographically random salt and iteration count.
 */
export async function hashPassword(
  password: string,
  iterations: number = DEFAULT_PBKDF2_ITERATIONS
): Promise<HashResult> {
  const validation = validatePassword(password);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const normalized = normalizePassword(password);
  const saltBytes = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const enc = new TextEncoder();

  const passwordKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(normalized),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations,
      hash: 'SHA-256',
    },
    passwordKey,
    KEY_BYTES * 8
  );

  return {
    hash: uint8ArrayToHex(new Uint8Array(derivedBits)),
    salt: uint8ArrayToHex(saltBytes),
    algorithm: HASH_ALGORITHM_IDENTIFIER,
    iterations,
  };
}

/**
 * Verifies a password against a stored hash, salt, and iteration count.
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
  storedSalt: string,
  iterations: number = DEFAULT_PBKDF2_ITERATIONS
): Promise<boolean> {
  if (!password || !storedHash || !storedSalt) {
    return false;
  }

  try {
    const normalized = normalizePassword(password);
    const saltBytes = hexToUint8Array(storedSalt);
    const enc = new TextEncoder();

    const passwordKey = await crypto.subtle.importKey(
      'raw',
      enc.encode(normalized),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltBytes,
        iterations,
        hash: 'SHA-256',
      },
      passwordKey,
      KEY_BYTES * 8
    );

    const computedHash = uint8ArrayToHex(new Uint8Array(derivedBits));
    return constantTimeCompare(computedHash, storedHash);
  } catch (err) {
    return false;
  }
}

/**
 * Constant-time string equality check to mitigate timing attacks.
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}
