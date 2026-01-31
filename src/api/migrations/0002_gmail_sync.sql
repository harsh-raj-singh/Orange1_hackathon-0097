-- Gmail sync tracking table
CREATE TABLE IF NOT EXISTS gmail_processed_emails (
    email_id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    subject TEXT,
    from_address TEXT,
    processed_at INTEGER DEFAULT (unixepoch()),
    created_at INTEGER DEFAULT (unixepoch())
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_gmail_processed_at ON gmail_processed_emails(processed_at);
CREATE INDEX IF NOT EXISTS idx_gmail_thread_id ON gmail_processed_emails(thread_id);
