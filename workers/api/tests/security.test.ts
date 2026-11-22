/**
 * Security & Tenant Isolation Test Suite
 * 
 * Tests:
 * 1. Web Crypto PBKDF2 Password Hashing & Verification.
 * 2. AES-256-GCM BYOK Credential Encryption, Decryption, and Masking.
 * 3. Tamper Detection: Corrupted ciphertext, wrong IV, and mismatched AAD (user/credential binding).
 * 4. Session Token Generation, SHA-256 Hashing, and Verification.
 * 5. Mock In-Memory D1 Tenant Isolation (User A vs User B cross-tenant protection).
 */

import { hashPassword, verifyPassword } from '../src/auth/passwords';
import {
  encryptCredential,
  decryptCredential,
  validateEncryptionConfiguration,
  maskApiKey,
} from '../src/security/crypto';
import { generateSessionToken, hashSessionToken } from '../src/auth/sessions';

async function runTests() {
  console.log('--- Starting Milestone 2 Security & Tenant Isolation Tests ---');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}`);
      failed++;
    }
  }

  // 1. Password Hashing (PBKDF2)
  try {
    const password = 'SuperSecurePassword123!';
    const { hash, salt } = await hashPassword(password);
    assert(hash.length === 64, 'PBKDF2 produces 256-bit (64 hex char) hash');
    assert(salt.length === 32, 'PBKDF2 produces 16-byte (32 hex char) salt');

    const validCheck = await verifyPassword(password, hash, salt);
    assert(validCheck === true, 'Valid password verifies successfully');

    const invalidCheck = await verifyPassword('WrongPassword123!', hash, salt);
    assert(invalidCheck === false, 'Invalid password is rejected');
  } catch (err) {
    console.error('Password test error:', err);
    failed++;
  }

  // 2. AES-256-GCM Credential Encryption & AAD
  const TEST_SECRET = 'super_secret_encryption_key_minimum_32_characters_long!';
  try {
    validateEncryptionConfiguration(TEST_SECRET);
    assert(true, 'Encryption configuration validation passes for >=32 char secret');

    let shortSecretFailed = false;
    try {
      validateEncryptionConfiguration('short_secret');
    } catch {
      shortSecretFailed = true;
    }
    assert(shortSecretFailed, 'Encryption configuration rejects secrets shorter than 32 chars');

    const apiKey = 'sk-proj-testKey1234567890abcdefghijklmnopqrstuvwxyz';
    const userIdA = 'user-uuid-aaa-111';
    const credId1 = 'cred-uuid-111-222';

    const encrypted = await encryptCredential(apiKey, TEST_SECRET, {
      userId: userIdA,
      credentialId: credId1,
    });

    assert(encrypted.encryptedKey.length > 0, 'Encrypted key payload is generated');
    assert(encrypted.keyIv.length > 0, 'Unique IV is generated');
    assert(encrypted.maskedKey === 'sk-p••••••••wxyz', 'API key is masked safely without exposing inner characters');

    // Decrypt with matching user and credential context
    const decrypted = await decryptCredential(encrypted, TEST_SECRET, {
      userId: userIdA,
      credentialId: credId1,
    });
    assert(decrypted === apiKey, 'Decryption recovers exact original API key');

    // 3. Tamper Detection & Cross-User AAD Binding Tests
    // A) Mismatched User ID in AAD
    const userIdB = 'user-uuid-bbb-222';
    let userMismatchFailed = false;
    try {
      await decryptCredential(encrypted, TEST_SECRET, {
        userId: userIdB,
        credentialId: credId1,
      });
    } catch {
      userMismatchFailed = true;
    }
    assert(userMismatchFailed, 'Tamper Detection: Decryption fails if requested by User B (AAD mismatch)');

    // B) Mismatched Credential ID in AAD
    let credMismatchFailed = false;
    try {
      await decryptCredential(encrypted, TEST_SECRET, {
        userId: userIdA,
        credentialId: 'different-cred-id',
      });
    } catch {
      credMismatchFailed = true;
    }
    assert(credMismatchFailed, 'Tamper Detection: Decryption fails if credential ID is altered');

    // C) Corrupted Ciphertext
    let corruptedFailed = false;
    try {
      const corruptedPayload = {
        ...encrypted,
        encryptedKey: btoa('tampered_arbitrary_ciphertext_data'),
      };
      await decryptCredential(corruptedPayload, TEST_SECRET, {
        userId: userIdA,
        credentialId: credId1,
      });
    } catch {
      corruptedFailed = true;
    }
    assert(corruptedFailed, 'Tamper Detection: Decryption fails on modified ciphertext');
  } catch (err) {
    console.error('Encryption test error:', err);
    failed++;
  }

  // 4. Session Tokens
  try {
    const token = generateSessionToken();
    assert(token.length === 64, 'Session token is 64 hex characters (32 bytes)');
    const hash1 = await hashSessionToken(token);
    const hash2 = await hashSessionToken(token);
    assert(hash1 === hash2, 'Session token hashing is deterministic SHA-256');
    assert(hash1 !== token, 'Raw token is never identical to hash');
  } catch (err) {
    console.error('Session test error:', err);
    failed++;
  }

  // 5. Tenant Isolation Logic Simulation
  try {
    interface Record {
      id: string;
      userId: string;
      data: string;
    }

    const database: Record[] = [
      { id: 'rec-1', userId: 'user-A', data: "User A's Private Memory" },
      { id: 'rec-2', userId: 'user-B', data: "User B's Private Memory" },
    ];

    // Simulated tenant isolation query
    function getRecord(authenticatedUserId: string, recordId: string) {
      return database.find((r) => r.id === recordId && r.userId === authenticatedUserId);
    }

    function deleteRecord(authenticatedUserId: string, recordId: string) {
      const index = database.findIndex((r) => r.id === recordId && r.userId === authenticatedUserId);
      if (index !== -1) {
        database.splice(index, 1);
        return true;
      }
      return false;
    }

    // User A attempts to read User A's record -> SUCCESS
    const userAReadSelf = getRecord('user-A', 'rec-1');
    assert(userAReadSelf !== undefined && userAReadSelf.data === "User A's Private Memory", 'Tenant Isolation: User A reads own record');

    // User A attempts to read User B's record -> BLOCKED
    const userAReadB = getRecord('user-A', 'rec-2');
    assert(userAReadB === undefined, 'Tenant Isolation: User A CANNOT read User B record (Blocked)');

    // User A attempts to delete User B's record -> BLOCKED
    const userADeleteB = deleteRecord('user-A', 'rec-2');
    assert(userADeleteB === false, 'Tenant Isolation: User A CANNOT delete User B record (Blocked)');
    assert(database.some((r) => r.id === 'rec-2'), "User B's record remains intact after User A's malicious delete attempt");
  } catch (err) {
    console.error('Tenant isolation test error:', err);
    failed++;
  }

  console.log(`\nTest Summary: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
