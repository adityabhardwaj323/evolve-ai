/**
 * Web Crypto AES-256-GCM Credential Encryption Service
 * 
 * Cryptographic Architecture & Hardening:
 * - Master Secret: Requires EXACTLY 32 cryptographically random bytes (256 bits of entropy).
 *   Supplied either as 64 hex characters or 43-44 base64/base64url characters.
 *   Arbitrary text strings are strictly rejected to guarantee 256-bit entropy.
 * - Key Derivation: RFC 5869 HKDF-SHA256 with fixed salt and versioned application info.
 * - Cipher: AES-256-GCM with 128-bit authentication tag appended directly to ciphertext.
 * - IV: Fresh cryptographically random 12-byte (96-bit) IV generated per encryption call.
 * - Authenticated Additional Data (AAD): Canonical JSON string binding:
 *     - userId
 *     - credentialId
 *     - version
 * - Key Rotation Procedure: Functions support re-encrypting existing records with new version/secret
 *   without exposing keys.
 * - Zero plaintext API keys appear in logs, responses, or error messages.
 */

export interface EncryptedPayload {
  encryptedKey: string;      // Base64 encoded ciphertext + 16-byte authentication tag
  keyIv: string;             // Base64 encoded 12-byte IV
  encryptionVersion: number; // Stored for key rotation
  maskedKey: string;         // e.g. "sk-a••••••••99ab"
}

export interface AADContext {
  userId: string;
  credentialId: string;
  version: number;
}

export const CURRENT_ENCRYPTION_VERSION = 1;
const IV_LENGTH_BYTES = 12; // 96-bit IV
const HKDF_INFO_PREFIX = 'evolve-ai:byok-key-derivation:v';
const HKDF_FIXED_SALT = new TextEncoder().encode('evolve-ai:fixed-credential-salt-v1');

/**
 * Validates and decodes the master secret into exactly 32 bytes (256 bits).
 * Accepts:
 *   1. 64-character hexadecimal string [0-9a-fA-F]
 *   2. 43-44 character standard Base64 or Base64Url string
 * Arbitrary text strings are strictly rejected to ensure true 256-bit cryptographic entropy.
 */
export function decodeMasterSecret(secret?: string): Uint8Array {
  if (!secret || typeof secret !== 'string') {
    throw new Error('ENCRYPTION_SECRET is required and must be a string.');
  }

  const trimmed = secret.trim();

  // Check 1: 64-character Hexadecimal (32 bytes)
  if (trimmed.length === 64 && /^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 64; i += 2) {
      bytes[i / 2] = parseInt(trimmed.substring(i, i + 2), 16);
    }
    return bytes;
  }

  // Check 2: Base64 / Base64URL string (32 bytes decode length)
  const base64Std = trimmed.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const binary = atob(base64Std);
    if (binary.length === 32) {
      const bytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    }
  } catch {
    // Not valid base64
  }

  throw new Error(
    'ENCRYPTION_SECRET must decode to exactly 32 cryptographically random bytes (provide either a 64-character hex string or 43-44 character base64/base64url string). Arbitrary text strings are rejected.'
  );
}

/**
 * Validates configuration without exposing secret material.
 */
export function validateEncryptionConfiguration(secret?: string): void {
  decodeMasterSecret(secret);
}

/**
 * Derives a 256-bit AES-GCM CryptoKey using HKDF-SHA256 from the decoded 32-byte secret.
 */
export async function deriveKeyWithHKDF(secret: string, version: number = CURRENT_ENCRYPTION_VERSION): Promise<CryptoKey> {
  const secretBytes = decodeMasterSecret(secret);
  const enc = new TextEncoder();

  // Import raw master key material
  const baseKey = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HKDF' },
    false,
    ['deriveKey']
  );

  const infoBytes = enc.encode(`${HKDF_INFO_PREFIX}${version}`);

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: HKDF_FIXED_SALT,
      info: infoBytes,
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Serializes canonical AAD buffer consistently for encryption and decryption.
 */
export function createCanonicalAAD(context: AADContext): Uint8Array {
  const canonicalString = JSON.stringify({
    credentialId: context.credentialId,
    userId: context.userId,
    version: context.version,
  });
  return new TextEncoder().encode(canonicalString);
}

/**
 * Masks an API key for safe user display.
 */
export function maskApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 8) {
    return '••••••••';
  }
  const prefix = trimmed.slice(0, 4);
  const suffix = trimmed.slice(-4);
  return `${prefix}••••••••${suffix}`;
}

/**
 * Encrypts an API credential using AES-256-GCM + HKDF derived key + 12-byte IV + canonical AAD.
 */
export async function encryptCredential(
  apiKey: string,
  secret: string,
  context: { userId: string; credentialId: string },
  version: number = CURRENT_ENCRYPTION_VERSION
): Promise<EncryptedPayload> {
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('Cannot encrypt empty API key.');
  }

  const derivedKey = await deriveKeyWithHKDF(secret, version);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const aad = createCanonicalAAD({
    userId: context.userId,
    credentialId: context.credentialId,
    version,
  });

  const plaintextBytes = new TextEncoder().encode(apiKey.trim());

  // Web Crypto AES-GCM appends the 128-bit authentication tag directly to ciphertext
  const cipherBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: aad,
      tagLength: 128,
    },
    derivedKey,
    plaintextBytes
  );

  return {
    encryptedKey: uint8ArrayToBase64(new Uint8Array(cipherBuffer)),
    keyIv: uint8ArrayToBase64(iv),
    encryptionVersion: version,
    maskedKey: maskApiKey(apiKey),
  };
}

/**
 * Decrypts an API credential using AES-256-GCM + HKDF derived key + canonical AAD verification.
 * Throws if ciphertext is tampered with, wrong key is used, or AAD does not match.
 */
export async function decryptCredential(
  payload: {
    encryptedKey: string;
    keyIv: string;
    encryptionVersion: number;
  },
  secret: string,
  context: { userId: string; credentialId: string }
): Promise<string> {
  const derivedKey = await deriveKeyWithHKDF(secret, payload.encryptionVersion);
  const iv = base64ToUint8Array(payload.keyIv);
  const ciphertextWithTag = base64ToUint8Array(payload.encryptedKey);

  const aad = createCanonicalAAD({
    userId: context.userId,
    credentialId: context.credentialId,
    version: payload.encryptionVersion,
  });

  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: aad,
        tagLength: 128,
      },
      derivedKey,
      ciphertextWithTag
    );

    return new TextDecoder().decode(decryptedBuffer);
  } catch (err) {
    throw new Error('Decryption failed: Authentication tag verification failed (ciphertext corrupted, wrong secret, or AAD mismatch).');
  }
}

/**
 * Key Rotation Procedure Helper:
 * Decrypts a credential under an old secret/version and re-encrypts under a new secret/version.
 * All in-memory, without storing plaintext.
 */
export async function rotateCredentialKey(
  payload: {
    encryptedKey: string;
    keyIv: string;
    encryptionVersion: number;
  },
  oldSecret: string,
  newSecret: string,
  newVersion: number,
  context: { userId: string; credentialId: string }
): Promise<EncryptedPayload> {
  const decrypted = await decryptCredential(payload, oldSecret, context);
  return encryptCredential(decrypted, newSecret, context, newVersion);
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
