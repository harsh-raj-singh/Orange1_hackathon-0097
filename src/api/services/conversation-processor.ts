import type { D1Database } from "@cloudflare/workers-types";
import type { ChatMessage } from "../types";
import { createLLMService, type ConversationAnalysis } from "./llm";

// Stale threshold in seconds (2 minutes for testing)
const STALE_THRESHOLD_SECONDS = 2 * 60;

export interface ProcessingResult {
  conversationId: string;
  userId: string;
  isUseful: boolean;
  reason: string;
  topicsCreated: string[];
  insightsCreated: number;
}

export interface StaleConversation {
  id: string;
  user_id: string;
  updated_at: number;
  message_count: number;
}

/**
 * Find conversations that haven't been updated recently and need processing
 */
export async function findStaleConversations(
  db: D1Database,
  thresholdSeconds: number = STALE_THRESHOLD_SECONDS
): Promise<StaleConversation[]> {
  const cutoffTime = Math.floor(Date.now() / 1000) - thresholdSeconds;
  
  const result = await db.prepare(`
    SELECT id, user_id, updated_at, message_count
    FROM conversations
    WHERE processed = 0
      AND updated_at < ?
      AND message_count > 0
    ORDER BY updated_at ASC
    LIMIT 10
  `).bind(cutoffTime).all<StaleConversation>();
  
  return result.results || [];
}

/**
 * Get all messages for a conversation
 */
export async function getConversationMessages(
  db: D1Database,
  conversationId: string
): Promise<ChatMessage[]> {
  const result = await db.prepare(`
    SELECT id, role, content
    FROM messages
    WHERE conversation_id = ?
    ORDER BY created_at ASC
  `).bind(conversationId).all<{ id: string; role: string; content: string }>();
  
  return (result.results || []).map(m => ({
    id: m.id,
    role: m.role as "user" | "assistant",
    content: m.content,
  }));
}

/**
 * Store insights and topics from a useful conversation
 */
async function storeConversationData(
  db: D1Database,
  conversationId: string,
  userId: string,
  analysis: ConversationAnalysis
): Promise<{ topicsCreated: string[]; insightsCreated: number }> {
  const topicsCreated: string[] = [];
  let insightsCreated = 0;
  
  // Store topics and update frequency
  for (const topicName of analysis.topics) {
    const topicId = `topic_${topicName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
    
    // Upsert topic with frequency increment
    await db.prepare(`
      INSERT INTO topics (id, name, description)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        description = COALESCE(excluded.description, description)
    `).bind(topicId, topicName, analysis.summary).run();
    
    // Link conversation to topic
    await db.prepare(`
      INSERT OR IGNORE INTO conversation_topics (conversation_id, topic_id)
      VALUES (?, ?)
    `).bind(conversationId, topicId).run();
    
    topicsCreated.push(topicName);
  }
  
  // Create topic relations between extracted topics
  for (let i = 0; i < analysis.topics.length; i++) {
    for (let j = i + 1; j < analysis.topics.length; j++) {
      const sourceId = `topic_${analysis.topics[i].toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
      const targetId = `topic_${analysis.topics[j].toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
      const relationId = `rel_${sourceId}_${targetId}`;
      
      await db.prepare(`
        INSERT INTO topic_relations (id, source_topic_id, target_topic_id, strength, relation_type)
        VALUES (?, ?, ?, 0.5, 'related')
        ON CONFLICT(id) DO UPDATE SET
          strength = MIN(1.0, strength + 0.1)
      `).bind(relationId, sourceId, targetId).run();
    }
  }
  
  // Store insights
  for (const insightContent of analysis.insights) {
    const insightId = `insight_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    await db.prepare(`
      INSERT INTO insights (id, conversation_id, user_id, content, importance_score)
      VALUES (?, ?, ?, ?, 0.7)
    `).bind(insightId, conversationId, userId, insightContent).run();
    
    // Link insight to topics
    for (const topicName of analysis.topics) {
      const topicId = `topic_${topicName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
      await db.prepare(`
        INSERT OR IGNORE INTO insight_topics (insight_id, topic_id)
        VALUES (?, ?)
      `).bind(insightId, topicId).run();
    }
    
    insightsCreated++;
  }
  
  // Store in global insights if user has consent
  const user = await db.prepare(`
    SELECT consent_global FROM users WHERE id = ?
  `).bind(userId).first<{ consent_global: number }>();
  
  if (user?.consent_global) {
    const globalInsightId = `global_${conversationId}`;
    const topicIds = analysis.topics.map(t => 
      `topic_${t.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`
    ).join(',');
    
    await db.prepare(`
      INSERT OR REPLACE INTO global_insights (id, content, topic_ids)
      VALUES (?, ?, ?)
    `).bind(globalInsightId, analysis.summary, topicIds).run();
  }
  
  return { topicsCreated, insightsCreated };
}

/**
 * Process a single stale conversation
 */
export async function processConversation(
  db: D1Database,
  llm: ReturnType<typeof createLLMService>,
  conversation: StaleConversation
): Promise<ProcessingResult> {
  const messages = await getConversationMessages(db, conversation.id);
  
  if (messages.length === 0) {
    // Mark as processed (nothing to analyze)
    await db.prepare(`
      UPDATE conversations SET processed = 1, is_useful = 0, usefulness_reason = 'No messages'
      WHERE id = ?
    `).bind(conversation.id).run();
    
    return {
      conversationId: conversation.id,
      userId: conversation.user_id,
      isUseful: false,
      reason: "No messages",
      topicsCreated: [],
      insightsCreated: 0,
    };
  }
  
  // Analyze conversation with LLM
  const analysis = await llm.analyzeConversation(messages);
  
  let topicsCreated: string[] = [];
  let insightsCreated = 0;
  
  // Only store data if the conversation is useful
  if (analysis.isUseful) {
    const result = await storeConversationData(
      db,
      conversation.id,
      conversation.user_id,
      analysis
    );
    topicsCreated = result.topicsCreated;
    insightsCreated = result.insightsCreated;
  }
  
  // Mark conversation as processed
  await db.prepare(`
    UPDATE conversations 
    SET processed = 1, is_useful = ?, usefulness_reason = ?
    WHERE id = ?
  `).bind(
    analysis.isUseful ? 1 : 0,
    analysis.reason,
    conversation.id
  ).run();
  
  // Log the processing
  const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await db.prepare(`
    INSERT INTO conversation_processing_logs 
    (id, conversation_id, user_id, processed_at, is_useful, reason, topics_extracted, insights_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    logId,
    conversation.id,
    conversation.user_id,
    Math.floor(Date.now() / 1000),
    analysis.isUseful ? 1 : 0,
    analysis.reason,
    JSON.stringify(topicsCreated),
    insightsCreated
  ).run();
  
  return {
    conversationId: conversation.id,
    userId: conversation.user_id,
    isUseful: analysis.isUseful,
    reason: analysis.reason,
    topicsCreated,
    insightsCreated,
  };
}

/**
 * Process all stale conversations (called by cron/scheduled job)
 */
export async function processStaleConversations(
  db: D1Database,
  llm: ReturnType<typeof createLLMService>
): Promise<{
  processed: number;
  useful: number;
  notUseful: number;
  results: ProcessingResult[];
}> {
  const staleConversations = await findStaleConversations(db);
  
  const results: ProcessingResult[] = [];
  let useful = 0;
  let notUseful = 0;
  
  for (const conversation of staleConversations) {
    try {
      const result = await processConversation(db, llm, conversation);
      results.push(result);
      
      if (result.isUseful) {
        useful++;
      } else {
        notUseful++;
      }
    } catch (error) {
      console.error(`Failed to process conversation ${conversation.id}:`, error);
      // Mark as processed to avoid retry loop
      await db.prepare(`
        UPDATE conversations SET processed = 1, is_useful = 0, usefulness_reason = 'Processing error'
        WHERE id = ?
      `).bind(conversation.id).run();
    }
  }
  
  return {
    processed: results.length,
    useful,
    notUseful,
    results,
  };
}

/**
 * Get recent processing logs for visibility
 */
export async function getRecentProcessingLogs(
  db: D1Database,
  limit: number = 20
): Promise<Array<{
  id: string;
  conversation_id: string;
  user_id: string;
  processed_at: number;
  is_useful: boolean;
  reason: string;
  topics_extracted: string[];
  insights_count: number;
}>> {
  const result = await db.prepare(`
    SELECT * FROM conversation_processing_logs
    ORDER BY processed_at DESC
    LIMIT ?
  `).bind(limit).all();
  
  return (result.results || []).map((row: any) => ({
    id: row.id,
    conversation_id: row.conversation_id,
    user_id: row.user_id,
    processed_at: row.processed_at,
    is_useful: row.is_useful === 1,
    reason: row.reason || "",
    topics_extracted: JSON.parse(row.topics_extracted || "[]"),
    insights_count: row.insights_count || 0,
  }));
}
