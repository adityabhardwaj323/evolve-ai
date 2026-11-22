/**
 * Web Crypto Password Hashing Service
 * 
 * Uses PBKDF2 with SHA-256 and 100,000 iterations.
 * Engineered for native Web Crypto running within Cloudflare Workers Free CPU budget (10ms).
 * Unique 16-byte cryptographically secure salt generated per user.
 */

const PBKDF2_ITERATIONS = 100000;
const SALT_BYTES = 16;
const KEY_BYTES = 32; // 256-bit derived key

export interface HashResult {
  hash: string; // hex encoded
  salt: string; // hex encoded
}

export async function hashPassword(password: string): Promise<HashResult> {
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters long.');
  }

  const saltBytes = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const enc = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    KEY_BYTES * 8
  );

  return {
    hash: uint8ArrayToHex(new Uint8Array(derivedBits)),
    salt: uint8ArrayToHex(saltBytes),
  };
}

export async function verifyPassword(password: string, storedHash: string, storedSalt: string): Promise<boolean> {
  if (!password || !storedHash || !storedSalt) {
    return false;
  }

  const saltBytes = hexToUint8Array(storedSalt);
  const enc = new TextEncoder();

  try {
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltBytes,
        iterations: PBKDF2_ITERATIONS,
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
