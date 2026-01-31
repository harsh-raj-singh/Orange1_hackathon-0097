import type { D1Database } from "@cloudflare/workers-types";
import type { ExtractionResult } from "../types";

export interface EmailRecord {
  id: string;
  threadId: string;
  snippet: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  textContent: string;
}

export interface GmailSyncResult {
  processed: number;
  skipped: number;
  errors: number;
  emailIds: string[];
}

// Global user ID for Gmail-sourced data
export const GMAIL_USER_ID = "gmail_sync_global";

/**
 * Extract plain text from HTML content
 */
export function extractTextFromHtml(html: string): string {
  if (!html) return '';
  
  // Remove script and style tags with content
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  
  // Replace common block elements with newlines
  text = text.replace(/<\/(p|div|br|h[1-6]|li|tr)>/gi, '\n');
  text = text.replace(/<(br|hr)[^>]*>/gi, '\n');
  
  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  
  // Decode HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num)));
  
  // Clean up whitespace
  text = text.replace(/\s+/g, ' ');
  text = text.replace(/\n\s+/g, '\n');
  text = text.replace(/\n+/g, '\n');
  
  return text.trim().slice(0, 10000); // Limit to 10k chars
}

/**
 * Parse email headers to extract subject, from, to, date
 */
export function parseEmailHeaders(headers: Array<{ name: string; value: string }>): { 
  subject: string; 
  from: string; 
  to: string; 
  date: string;
} {
  const getHeader = (name: string) => 
    headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
  
  return {
    subject: getHeader('Subject'),
    from: getHeader('From'),
    to: getHeader('To'),
    date: getHeader('Date'),
  };
}

/**
 * Check if an email has already been processed
 */
export async function isEmailProcessed(db: D1Database, emailId: string): Promise<boolean> {
  const result = await db.prepare(
    "SELECT 1 FROM gmail_processed_emails WHERE email_id = ?"
  ).bind(emailId).first();
  return !!result;
}

/**
 * Mark an email as processed
 */
export async function markEmailProcessed(
  db: D1Database, 
  emailId: string, 
  threadId: string,
  subject: string,
  fromAddress: string
): Promise<void> {
  await db.prepare(
    "INSERT OR IGNORE INTO gmail_processed_emails (email_id, thread_id, subject, from_address) VALUES (?, ?, ?, ?)"
  ).bind(emailId, threadId, subject, fromAddress).run();
}

/**
 * Ensure Gmail user exists
 */
export async function ensureGmailUser(db: D1Database): Promise<void> {
  await db.prepare(
    "INSERT OR IGNORE INTO users (id, consent_global) VALUES (?, 1)"
  ).bind(GMAIL_USER_ID).run();
}

/**
 * Store Gmail insights in the global knowledge graph
 */
export async function storeGmailInsights(
  db: D1Database,
  emailId: string,
  subject: string,
  fromAddress: string,
  insights: ExtractionResult
): Promise<void> {
  // Ensure Gmail user exists
  await ensureGmailUser(db);
  
  // Create a conversation record for this email
  const conversationId = `gmail_${emailId}`;
  await db.prepare(`
    INSERT OR IGNORE INTO conversations (id, user_id, summary, message_count)
    VALUES (?, ?, ?, 1)
  `).bind(conversationId, GMAIL_USER_ID, `[Gmail] ${subject}`).run();
  
  // Store each topic
  for (const topic of insights.topics) {
    const topicName = `gmail-${topic}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const topicId = `topic_${topicName}`;
    
    await db.prepare(`
      INSERT INTO topics (id, name, description)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET description = COALESCE(excluded.description, description)
    `).bind(topicId, topicName, insights.summary || subject).run();
    
    // Link conversation to topic
    await db.prepare(`
      INSERT OR IGNORE INTO conversation_topics (conversation_id, topic_id)
      VALUES (?, ?)
    `).bind(conversationId, topicId).run();
  }
  
  // Store insights
  for (const insight of insights.insights) {
    const insightId = `gmail_insight_${emailId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    await db.prepare(`
      INSERT INTO insights (id, conversation_id, user_id, content, importance_score)
      VALUES (?, ?, ?, ?, 0.7)
    `).bind(insightId, conversationId, GMAIL_USER_ID, `[Gmail] ${insight}`).run();
    
    // Link insight to topics
    for (const topic of insights.topics) {
      const topicName = `gmail-${topic}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const topicId = `topic_${topicName}`;
      await db.prepare(`
        INSERT OR IGNORE INTO insight_topics (insight_id, topic_id)
        VALUES (?, ?)
      `).bind(insightId, topicId).run();
    }
  }
  
  // Store in global insights for sharing
  const globalInsightId = `gmail_global_${emailId}`;
  const topicIds = insights.topics.map(t => `topic_gmail-${t.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`).join(',');
  
  await db.prepare(`
    INSERT OR IGNORE INTO global_insights (id, content, topic_ids)
    VALUES (?, ?, ?)
  `).bind(globalInsightId, `[Gmail: ${subject}] ${insights.summary}`, topicIds).run();
}

/**
 * Get sync statistics
 */
export async function getGmailSyncStats(db: D1Database): Promise<{
  totalProcessed: number;
  lastSyncAt: number | null;
  recentEmails: Array<{ subject: string; from_address: string; processed_at: number }>;
}> {
  const countResult = await db.prepare(
    "SELECT COUNT(*) as count FROM gmail_processed_emails"
  ).first<{ count: number }>();
  
  const lastResult = await db.prepare(
    "SELECT processed_at FROM gmail_processed_emails ORDER BY processed_at DESC LIMIT 1"
  ).first<{ processed_at: number }>();
  
  const recentResult = await db.prepare(
    "SELECT subject, from_address, processed_at FROM gmail_processed_emails ORDER BY processed_at DESC LIMIT 5"
  ).all<{ subject: string; from_address: string; processed_at: number }>();
  
  return {
    totalProcessed: countResult?.count || 0,
    lastSyncAt: lastResult?.processed_at || null,
    recentEmails: recentResult?.results || [],
  };
}
