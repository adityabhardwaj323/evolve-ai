# EvolveAI Security & Isolation Model

## 1. Authentication Architecture
- **Web Crypto PBKDF2 Password Hashing**:
  - Algorithm: PBKDF2 with HMAC-SHA-256.
  - Iterations: 100,000 iterations (standard OWASP recommendation for PBKDF2-HMAC-SHA256, carefully evaluated for execution within the 10ms Cloudflare Workers Free CPU limit without native WASM overhead).
  - Salt: Unique, cryptographically random 16-byte salt per user (`crypto.getRandomValues`).
  - Passwords: Minimum 8 characters enforced.
  - Privacy: Plaintext passwords, password hashes, and salts are never returned to client responses.
- **Opaque Cryptographically Random Session Tokens**:
  - Tokens: 32 bytes (64 hex characters) generated via Web Crypto.
  - Storage: Only the SHA-256 hash of the token (`token_hash`) is persisted in Cloudflare D1. Raw tokens are never stored in the database.
  - Cookies: Delivered to the browser via `HttpOnly`, `Secure` (production), `SameSite=Lax` cookies named `evolve_session`. Never stored in `localStorage`.
  - Expiration & Revocation: 7-day TTL verified on every query; active invalidation in D1 on logout.
- **Brute Force & Rate Limiting**:
  - Failed login attempts tracked per IP address and email in D1 table `login_attempts`.
  - Accounts locked for 15 minutes after 5 consecutive failed attempts.

## 2. BYOK API Credential Encryption Service
- **AES-256-GCM Encryption**:
  - Master Key: Derived from `ENCRYPTION_SECRET` (minimum 32 characters) via SHA-256 digest into a 256-bit AES-GCM `CryptoKey`.
  - Initialization Vector (IV): Unique, cryptographically random 12-byte (96-bit) IV generated for every individual credential encryption operation.
  - Authenticated Additional Data (AAD):
    - Format: `evolve-ai:v{version}:user:{userId}:cred:{credentialId}`
    - Cryptographically binds the ciphertext to the user's ID, credential ID, and encryption schema version.
    - Prevents ciphertext splicing, cross-user credential theft, and replaying a credential under another user account.
  - Tamper Detection: Modifying ciphertext, altering the IV, or presenting mismatched AAD immediately causes Web Crypto to throw an authentication tag verification failure.
  - Masking: Only prefixes and suffixes are returned to the client (e.g. `sk-p••••••••wxyz`). Decrypted credentials exist solely in Worker memory during provider forwarding and are never logged or returned to frontend responses.

## 3. Strict Multi-Tenant Isolation
- Identity is derived exclusively from the verified session token in `requireAuth` middleware.
- Client-supplied `user_id` fields in request bodies or query params are discarded.
- Every SELECT, UPDATE, and DELETE query enforces tenant ownership:
  - Conversations: `WHERE id = ? AND user_id = ?`
  - Memories: `WHERE id = ? AND user_id = ?`
  - Provider Credentials: `WHERE id = ? AND user_id = ?`
  - Projects: `WHERE id = ? AND user_id = ?`
- Verified by automated tests (`tests/security.test.ts`).

## 4. CORS & API Security Headers
- Explicit origin allowlist matching configured frontend origins (e.g. `http://localhost:5173`, `http://127.0.0.1:5173`, and production `CLIENT_ORIGIN`). Wildcards are forbidden when handling credentialed requests.
- Security Headers:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `X-XSS-Protection: 1; mode=block`
  - `Referrer-Policy: strict-origin-when-cross-origin`

## 5. Security Test Suite
Automated security test suite implemented in `workers/api/tests/security.test.ts` covering:
- PBKDF2 hash calculation and verification.
- AES-256-GCM encryption, decryption, and key masking.
- AAD mismatch tamper detection (User B attempting to decrypt User A's credential).
- Ciphertext tampering detection.
- Session token generation and SHA-256 hashing.
- Cross-tenant read, update, and delete blocking.
