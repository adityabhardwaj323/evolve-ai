# EvolveAI Security & Isolation Model

## 1. Authentication Architecture
- **Web Crypto PBKDF2 Password Hashing**:
  - Algorithm: PBKDF2 with HMAC-SHA-256.
  - Benchmarked Performance:
    - 100,000 iterations: ~33.3 ms wall clock (~8-10 ms pure CPU).
    - 310,000 iterations: ~98.3 ms.
    - 600,000 iterations: ~166.6 ms.
  - Runtime Free-Tier Limit: Cloudflare Workers Free has a strict 10ms CPU limit per invocation. 100,000 iterations is the maximum safe configuration that operates reliably on the free tier.
  - Algorithm & Iteration Metadata: Every user record in Cloudflare D1 explicitly stores `hash_algorithm` and `hash_iterations` to support future non-breaking hashing upgrades.
  - Salt: Unique, cryptographically random 16-byte salt per user generated via `crypto.getRandomValues`.
  - Passwords: Minimum 12 characters, maximum 128 characters. Normalized using Unicode NFKC (`normalize('NFKC')`) before hashing.
  - Privacy: Plaintext passwords, password hashes, and salts are never returned to client responses.
- **Opaque Session Tokens**:
  - Tokens: 32 bytes cryptographically random, encoded with base64url.
  - Storage: Only the SHA-256 hash of the token (`token_hash`) is persisted in Cloudflare D1.
  - Cookies: Delivered via `HttpOnly`, `SameSite=Lax`, and `Secure` (production) cookies named `evolve_session`. Never stored in `localStorage`.
  - Expiration & Revocation: 7-day TTL verified on every query; active invalidation in D1 on logout.
- **Layered Rate Limiting**:
  - Layer 1 (IP flood protection): Allows up to 20 requests/minute per IP; temporary block for 5 minutes.
  - Layer 2 (Account brute-force protection): Max 5 failed attempts per normalized email; progressive lockout (5 min -> 15 min -> 60 min).
  - Never permanently locks accounts.

## 2. BYOK API Credential Encryption Service
- **AES-256-GCM Encryption**:
  - Master Secret: 256-bit random string stored exclusively in Cloudflare Worker secrets (`ENCRYPTION_SECRET`), validated for >= 32 characters. Never derived from user passwords.
  - Key Derivation: RFC 5869 HKDF-SHA256 with fixed salt (`evolve-ai:fixed-credential-salt-v1`) and application-specific info binding the encryption version (`evolve-ai:byok-key-derivation:v{version}`).
  - Initialization Vector (IV): Cryptographically random 12-byte (96-bit) IV generated per encryption call.
  - Authenticated Additional Data (AAD): Canonical sorted JSON string:
    `{"credentialId":"crd_...","userId":"usr_...","version":1}`
  - Web Crypto Output Format: 128-bit authentication tag is appended directly to the ciphertext. No separate `aad_tag` column needed in D1.
  - Tamper Detection: Modifying ciphertext, altering the IV, or presenting mismatched AAD immediately causes Web Crypto to throw an authentication tag verification failure.
  - Key Rotation Readiness: Stored `encryption_version` enables rotating keys without credential disclosure.
  - Masking: Only prefixes and suffixes are returned to the client (e.g. `sk-p••••••••wxyz`). Decrypted credentials exist solely in Worker memory during provider forwarding and are never logged or returned to frontend API responses.

## 3. Strict Multi-Tenant Isolation
- Identity is derived exclusively from the verified session token in `requireAuth` middleware.
- Client-supplied `user_id` fields in request bodies or query params are discarded.
- Every SELECT, UPDATE, and DELETE query enforces tenant ownership:
  - Conversations: `WHERE id = ? AND user_id = ?`
  - Memories: `WHERE id = ? AND user_id = ?`
  - Provider Credentials: `WHERE id = ? AND user_id = ?`
  - Projects: `WHERE id = ? AND user_id = ?`

## 4. CSRF & Origin Verification
- State-changing requests (POST, PUT, PATCH, DELETE) require a verified `Origin` or `Referer` matching the allowlist (`CLIENT_ORIGIN` and local development origins).
- Security Headers:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `X-XSS-Protection: 1; mode=block`
  - `Referrer-Policy: strict-origin-when-cross-origin`

## 5. Security Test Suite
Automated security test suite in `workers/api/tests/security.test.ts` (27 passing tests):
- Password validation (12-128 chars).
- NFKC Unicode normalization.
- PBKDF2 hash & verification with stored metadata.
- Master secret length validation.
- HKDF key derivation with version separation.
- AES-256-GCM encryption & decryption with canonical AAD.
- Tamper detection on modified ciphertext, altered credential ID, and mismatched user ID.
- Base64url session token generation and SHA-256 hashing.
- Multi-tenant data isolation.
