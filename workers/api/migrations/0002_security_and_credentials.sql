-- EvolveAI Security Enhancements: Metadata and Layered Rate Limiting
-- Migration: 0002_security_and_credentials.sql

-- 1. Add algorithm and iteration metadata to users table for future hash upgrades
ALTER TABLE users ADD COLUMN hash_algorithm TEXT DEFAULT 'PBKDF2-HMAC-SHA256';
ALTER TABLE users ADD COLUMN hash_iterations INTEGER DEFAULT 100000;

-- 2. Add encryption_version to provider_credentials for key rotation support
ALTER TABLE provider_credentials ADD COLUMN encryption_version INTEGER DEFAULT 1;

-- 3. Layered rate limiting tables
CREATE TABLE IF NOT EXISTS ip_rate_limits (
  ip_address TEXT PRIMARY KEY,
  request_count INTEGER DEFAULT 1,
  first_request_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_request_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  blocked_until DATETIME
);
CREATE INDEX IF NOT EXISTS idx_ip_rate_limits_blocked ON ip_rate_limits(blocked_until);

CREATE TABLE IF NOT EXISTS account_rate_limits (
  email_normalized TEXT PRIMARY KEY,
  failed_attempts INTEGER DEFAULT 1,
  first_failed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_failed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  locked_until DATETIME
);
CREATE INDEX IF NOT EXISTS idx_account_rate_limits_locked ON account_rate_limits(locked_until);
