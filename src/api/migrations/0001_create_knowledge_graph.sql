-- Migration: Create Knowledge Graph Tables
-- Created: 2026-01-31

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at INTEGER DEFAULT (unixepoch()),
  consent_global INTEGER DEFAULT 0
);

-- Topics (Graph Nodes)
CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

-- Topic Relations (Graph Edges)
CREATE TABLE IF NOT EXISTS topic_relations (
  id TEXT PRIMARY KEY,
  source_topic_id TEXT NOT NULL REFERENCES topics(id),
  target_topic_id TEXT NOT NULL REFERENCES topics(id),
  strength REAL DEFAULT 0.5,
  relation_type TEXT DEFAULT 'related',
  created_at INTEGER DEFAULT (unixepoch())
);

-- Conversations
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  summary TEXT,
  message_count INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);

-- Key Insights
CREATE TABLE IF NOT EXISTS insights (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  importance_score REAL DEFAULT 0.5,
  embedding_id TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

-- Conversation-Topic Links
CREATE TABLE IF NOT EXISTS conversation_topics (
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  topic_id TEXT NOT NULL REFERENCES topics(id),
  PRIMARY KEY (conversation_id, topic_id)
);

-- Insight-Topic Links
CREATE TABLE IF NOT EXISTS insight_topics (
  insight_id TEXT NOT NULL REFERENCES insights(id),
  topic_id TEXT NOT NULL REFERENCES topics(id),
  PRIMARY KEY (insight_id, topic_id)
);

-- Global Insights (Anonymized)
CREATE TABLE IF NOT EXISTS global_insights (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  topic_ids TEXT,
  use_count INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (unixepoch())
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_insights_user ON insights(user_id);
CREATE INDEX IF NOT EXISTS idx_insights_conversation ON insights(conversation_id);
CREATE INDEX IF NOT EXISTS idx_topic_relations_source ON topic_relations(source_topic_id);
CREATE INDEX IF NOT EXISTS idx_topic_relations_target ON topic_relations(target_topic_id);
