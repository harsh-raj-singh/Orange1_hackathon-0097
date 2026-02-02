-- Migration: 0004_soft_delete_conversations.sql
-- Add soft delete columns to conversations table

-- Add deleted flag
ALTER TABLE conversations ADD COLUMN deleted INTEGER DEFAULT 0;

-- Add deleted_at timestamp
ALTER TABLE conversations ADD COLUMN deleted_at INTEGER;

-- Create index for faster queries on non-deleted conversations
CREATE INDEX IF NOT EXISTS idx_conversations_deleted ON conversations(user_id, deleted);
