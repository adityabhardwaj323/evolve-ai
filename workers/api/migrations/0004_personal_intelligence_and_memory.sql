-- Migration: 0004_personal_intelligence_and_memory.sql
-- Supports Milestone 4: Personal Intelligence, Persistent Memory & Self-Evolving Knowledge Engine

-- 1. Extend memories table with title, importance, last_accessed_at, expires_at, is_pinned, verification_status
ALTER TABLE memories ADD COLUMN title TEXT;
ALTER TABLE memories ADD COLUMN importance REAL DEFAULT 0.5;
ALTER TABLE memories ADD COLUMN last_accessed_at DATETIME;
ALTER TABLE memories ADD COLUMN expires_at DATETIME;
ALTER TABLE memories ADD COLUMN is_pinned INTEGER DEFAULT 0;
ALTER TABLE memories ADD COLUMN verification_status TEXT DEFAULT 'unverified';
ALTER TABLE memories ADD COLUMN source_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_memories_pinned ON memories(user_id, is_pinned);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(user_id, importance);
CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(user_id, category);

-- 2. Memory Access & Retrieval Logs table
CREATE TABLE IF NOT EXISTS memory_access_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  conversation_id TEXT,
  memory_id TEXT NOT NULL,
  retrieval_query TEXT,
  relevance_score REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_mem_access_user ON memory_access_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_mem_access_memory ON memory_access_logs(memory_id);

-- 3. Extend user_preferences with memory policy toggles
ALTER TABLE user_preferences ADD COLUMN memory_injection_enabled INTEGER DEFAULT 1;
ALTER TABLE user_preferences ADD COLUMN auto_memory_approval INTEGER DEFAULT 0;

-- 4. Extend feedback table with conversation_id, provider_type, model, and memory_ids
ALTER TABLE feedback ADD COLUMN conversation_id TEXT;
ALTER TABLE feedback ADD COLUMN provider_type TEXT;
ALTER TABLE feedback ADD COLUMN model TEXT;
ALTER TABLE feedback ADD COLUMN memory_ids_json TEXT;

CREATE INDEX IF NOT EXISTS idx_feedback_conversation ON feedback(conversation_id);

-- 5. Extend knowledge_entities and knowledge_relations indexes
CREATE INDEX IF NOT EXISTS idx_entities_project ON knowledge_entities(project_id);
CREATE INDEX IF NOT EXISTS idx_entities_type ON knowledge_entities(user_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_relations_source ON knowledge_relations(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_relations_target ON knowledge_relations(target_entity_id);
