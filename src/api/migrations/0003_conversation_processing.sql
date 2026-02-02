-- Migration: Add conversation processing for background job system
-- Tracks which conversations have been processed and their analysis results

-- Add processed flag and last activity timestamp to conversations
ALTER TABLE conversations ADD COLUMN processed INTEGER DEFAULT 0;
ALTER TABLE conversations ADD COLUMN last_activity_at INTEGER DEFAULT (unixepoch());
ALTER TABLE conversations ADD COLUMN is_useful INTEGER DEFAULT NULL;
ALTER TABLE conversations ADD COLUMN usefulness_reason TEXT DEFAULT NULL;

-- Create index for finding stale unprocessed conversations
CREATE INDEX IF NOT EXISTS idx_conversations_stale 
  ON conversations(processed, last_activity_at);

-- Table to track processing logs (for debugging/visibility)
CREATE TABLE IF NOT EXISTS conversation_processing_logs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  processed_at INTEGER DEFAULT (unixepoch()),
  is_useful INTEGER NOT NULL,
  reason TEXT,
  topics_extracted TEXT, -- JSON array
  insights_count INTEGER DEFAULT 0,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE INDEX IF NOT EXISTS idx_processing_logs_time 
  ON conversation_processing_logs(processed_at DESC);

-- Add frequency tracking to topics
ALTER TABLE topics ADD COLUMN frequency INTEGER DEFAULT 1;
ALTER TABLE topics ADD COLUMN last_used_at INTEGER DEFAULT (unixepoch());

-- Index for frequency-based queries
CREATE INDEX IF NOT EXISTS idx_topics_frequency 
  ON topics(frequency DESC);
