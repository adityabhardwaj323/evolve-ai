/**
 * Web Crypto AES-256-GCM Credential Encryption Service
 * 
 * Complies with strict security requirements:
 * - AES-256-GCM with 256-bit key.
 * - Key derived from server secret (ENCRYPTION_SECRET) via SHA-256 HKDF or single-step SHA-256 digest.
 * - Unique 12-byte cryptographically random IV per operation.
 * - Authenticated Additional Data (AAD) binding ciphertext to:
 *     - userId
 *     - credentialId
 *     - encryptionVersion
 * - Tamper detection (throws on modified ciphertext, bad IV, or mismatched AAD).
 * - Decrypted keys must never leave Worker memory or be logged.
 */

export interface EncryptedPayload {
  encryptedKey: string;      // Base64 encoded ciphertext + tag
  keyIv: string;             // Base64 encoded 12-byte IV
  encryptionVersion: number; // For rotation tracking
  maskedKey: string;         // e.g. "sk-...ab12"
}

export interface AADContext {
  userId: string;
  credentialId: string;
  version: number;
}

const CURRENT_ENCRYPTION_VERSION = 1;
const IV_LENGTH_BYTES = 12; // Standard 96-bit IV for AES-GCM

/**
 * Validates the runtime encryption configuration.
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
 * Derives a CryptoKey for AES-256-GCM using SHA-256 digest of the master secret.
 */
async function deriveMasterKey(secret: string): Promise<CryptoKey> {
  validateEncryptionConfiguration(secret);
  const enc = new TextEncoder();
  const secretBytes = enc.encode(secret);
  
  // Hash the secret to ensure exactly 32 bytes (256 bits)
  const keyMaterial = await crypto.subtle.digest('SHA-256', secretBytes);

  return crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Formats Authenticated Additional Data (AAD) into bytes.
 */
function createAADBuffer(context: AADContext): Uint8Array {
  const aadString = `evolve-ai:v${context.version}:user:${context.userId}:cred:${context.credentialId}`;
  return new TextEncoder().encode(aadString);
}

/**
 * Helper to produce a safe masked string for user display.
 * Never displays more than the prefix and suffix.
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
 * Encrypts an API credential using AES-256-GCM with unique IV and AAD binding.
 */
export async function encryptCredential(
  apiKey: string,
  secret: string,
  context: { userId: string; credentialId: string }
): Promise<EncryptedPayload> {
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('Cannot encrypt empty API key.');
  }

  const masterKey = await deriveMasterKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const aad = createAADBuffer({
    userId: context.userId,
    credentialId: context.credentialId,
    version: CURRENT_ENCRYPTION_VERSION,
  });

  const plaintextBytes = new TextEncoder().encode(apiKey.trim());

  const cipherBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: aad,
      tagLength: 128,
    },
    masterKey,
    plaintextBytes
  );

  return {
    encryptedKey: uint8ArrayToBase64(new Uint8Array(cipherBuffer)),
    keyIv: uint8ArrayToBase64(iv),
    encryptionVersion: CURRENT_ENCRYPTION_VERSION,
    maskedKey: maskApiKey(apiKey),
  };
}

/**
 * Decrypts an API credential using AES-256-GCM.
 * Validates AAD (userId, credentialId, version). Throws error if corrupted or mismatched.
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
  const masterKey = await deriveMasterKey(secret);
  const iv = base64ToUint8Array(payload.keyIv);
  const ciphertext = base64ToUint8Array(payload.encryptedKey);

  const aad = createAADBuffer({
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
      masterKey,
      ciphertext
    );

    return new TextDecoder().decode(decryptedBuffer);
  } catch (err) {
    throw new Error('Decryption failed: Ciphertext corrupted, invalid secret, or ownership mismatch (AAD failure).');
  }
}

// Base64 encoding/decoding helpers using standard Web APIs
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
