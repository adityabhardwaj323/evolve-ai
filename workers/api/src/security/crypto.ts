/**
 * Web Crypto AES-256-GCM Credential Encryption Service
 * 
 * Cryptographic Architecture:
 * - Master Secret: Minimum 32-character random string from Cloudflare Worker Secret.
 * - Key Derivation: RFC 5869 HKDF-SHA256 with documented fixed salt and application-specific info.
 * - Cipher: AES-256-GCM with 128-bit authentication tag appended directly to ciphertext.
 * - IV: Cryptographically random 12-byte (96-bit) IV per encryption call.
 * - Authenticated Additional Data (AAD): Canonical JSON string binding:
 *     - userId
 *     - credentialId
 *     - version
 * - Zero extra aad_tag column needed (Web Crypto AES-GCM appends tag directly).
 * - Decrypted keys never leave Worker memory or get exposed in responses or logs.
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
 * Validates that the runtime encryption secret satisfies 256-bit entropy requirements.
 */
export function validateEncryptionConfiguration(secret?: string): void {
  if (!secret || typeof secret !== 'string') {
    throw new Error('ENCRYPTION_SECRET is required and must be a string.');
  }
  if (secret.length < 32) {
    throw new Error('ENCRYPTION_SECRET must be at least 32 characters long for 256-bit security.');
  }
}

/**
 * Derives a 256-bit AES-GCM CryptoKey using HKDF-SHA256.
 * Binds derivation to the specific encryption version.
 */
export async function deriveKeyWithHKDF(secret: string, version: number = CURRENT_ENCRYPTION_VERSION): Promise<CryptoKey> {
  validateEncryptionConfiguration(secret);
  const enc = new TextEncoder();
  const secretBytes = enc.encode(secret);

  // Import base key material
  const baseKey = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HKDF' },
    false,
    ['deriveKey']
  );

  const infoBytes = enc.encode(`${HKDF_INFO_PREFIX}${version}`);

  // Derive AES-256-GCM key via HKDF-SHA256
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
 * Canonical JSON with sorted keys.
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

  // Web Crypto AES-GCM automatically appends the 128-bit authentication tag to the ciphertext buffer
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
