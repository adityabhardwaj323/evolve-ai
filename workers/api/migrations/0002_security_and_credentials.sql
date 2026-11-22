-- EvolveAI Security & Credentials Enhancement Migration
-- Migration: 0002_security_and_credentials.sql

-- 1. Add encryption_version to provider_credentials for key rotation support
ALTER TABLE provider_credentials ADD COLUMN encryption_version INTEGER DEFAULT 1;

-- 2. Login rate limiting / attempt tracking table
CREATE TABLE IF NOT EXISTS login_attempts (
  id TEXT PRIMARY KEY,
  ip_address TEXT NOT NULL,
  email TEXT NOT NULL,
  attempt_count INTEGER DEFAULT 1,
  last_attempt DATETIME DEFAULT CURRENT_TIMESTAMP,
  locked_until DATETIME
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_lookup ON login_attempts(ip_address, email);
