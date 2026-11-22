-- Migration: 0003_usage_and_provider_defaults.sql
-- Supports Milestone 3 provider defaults and token usage tracking

-- 1. Add is_default column to provider_credentials
ALTER TABLE provider_credentials ADD COLUMN is_default INTEGER DEFAULT 0;

-- 2. Usage events table for token counting and cost observability
CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  conversation_id TEXT,
  provider_type TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  success INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_events(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_events(created_at);
