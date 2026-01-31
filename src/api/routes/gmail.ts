import { Hono } from "hono";
import type { Env } from "../types";
import { createLLMService } from "../services/llm";
import {
  extractTextFromHtml,
  parseEmailHeaders,
  isEmailProcessed,
  markEmailProcessed,
  storeGmailInsights,
  getGmailSyncStats,
  GMAIL_USER_ID,
  type GmailSyncResult,
} from "../services/gmail-sync";

const gmailRouter = new Hono<{ Bindings: Env }>();

// Gmail connector configuration - these would come from env in production
const GMAIL_CONNECTOR_URL = "https://api.pipedream.com/v1/connect";

/**
 * POST /api/gmail/sync
 * Manually trigger Gmail sync or called by cron
 * Expects emails to be passed in the request body (from connector)
 */
gmailRouter.post("/sync", async (c) => {
  const body = await c.req.json<{ emails: any[]; maxResults?: number }>();
  const { emails = [], maxResults = 50 } = body;
  
  if (!emails || emails.length === 0) {
    return c.json({ error: "No emails provided. Call this endpoint with emails from Gmail connector." }, 400);
  }
  
  const db = c.env.DB;
  const llm = createLLMService(c.env.AI_GATEWAY_BASE_URL, c.env.AI_GATEWAY_API_KEY);
  
  const result: GmailSyncResult = {
    processed: 0,
    skipped: 0,
    errors: 0,
    emailIds: [],
  };
  
  for (const email of emails.slice(0, maxResults)) {
    try {
      const emailId = email.id;
      
      // Skip if already processed
      if (await isEmailProcessed(db, emailId)) {
        result.skipped++;
        continue;
      }
      
      // Extract email content
      const headers = email.payload?.headers || [];
      const { subject, from, to, date } = parseEmailHeaders(headers);
      
      // Get text content - prefer snippet if payload is HTML heavy
      let textContent = '';
      if (email.payload && typeof email.payload === 'string') {
        textContent = extractTextFromHtml(email.payload);
      } else if (email.snippet) {
        textContent = email.snippet;
      }
      
      // Skip if no meaningful content
      if (!textContent || textContent.length < 20) {
        result.skipped++;
        await markEmailProcessed(db, emailId, email.threadId, subject, from);
        continue;
      }
      
      // Build context for LLM
      const emailContext = `
Subject: ${subject}
From: ${from}
Date: ${date}

Content:
${textContent}
`.trim();
      
      // Extract insights using LLM
      const insights = await llm.extractInsights(emailContext);
      
      // Store in knowledge graph
      if (insights.topics.length > 0 || insights.insights.length > 0) {
        await storeGmailInsights(db, emailId, subject, from, insights);
        result.emailIds.push(emailId);
        result.processed++;
      } else {
        result.skipped++;
      }
      
      // Mark as processed
      await markEmailProcessed(db, emailId, email.threadId, subject, from);
      
    } catch (error) {
      console.error(`Error processing email ${email.id}:`, error);
      result.errors++;
    }
  }
  
  return c.json({
    success: true,
    result,
    message: `Processed ${result.processed} emails, skipped ${result.skipped}, errors ${result.errors}`,
  });
});

/**
 * GET /api/gmail/stats
 * Get Gmail sync statistics
 */
gmailRouter.get("/stats", async (c) => {
  const db = c.env.DB;
  
  try {
    const stats = await getGmailSyncStats(db);
    return c.json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error("Error getting Gmail stats:", error);
    return c.json({ error: "Failed to get stats" }, 500);
  }
});

/**
 * GET /api/gmail/insights
 * Get insights extracted from Gmail
 */
gmailRouter.get("/insights", async (c) => {
  const db = c.env.DB;
  const limit = parseInt(c.req.query("limit") || "20");
  
  try {
    const insights = await db.prepare(`
      SELECT i.id, i.content, i.created_at, c.summary as email_subject
      FROM insights i
      LEFT JOIN conversations c ON i.conversation_id = c.id
      WHERE i.user_id = ?
      ORDER BY i.created_at DESC
      LIMIT ?
    `).bind(GMAIL_USER_ID, limit).all();
    
    return c.json({
      success: true,
      insights: insights.results,
    });
  } catch (error) {
    console.error("Error getting Gmail insights:", error);
    return c.json({ error: "Failed to get insights" }, 500);
  }
});

/**
 * GET /api/gmail/topics
 * Get topics extracted from Gmail
 */
gmailRouter.get("/topics", async (c) => {
  const db = c.env.DB;
  
  try {
    const topics = await db.prepare(`
      SELECT t.id, t.name, t.description, COUNT(ct.conversation_id) as email_count
      FROM topics t
      LEFT JOIN conversation_topics ct ON t.id = ct.topic_id
      LEFT JOIN conversations c ON ct.conversation_id = c.id AND c.user_id = ?
      WHERE t.name LIKE 'gmail-%'
      GROUP BY t.id
      ORDER BY email_count DESC
      LIMIT 50
    `).bind(GMAIL_USER_ID).all();
    
    return c.json({
      success: true,
      topics: topics.results,
    });
  } catch (error) {
    console.error("Error getting Gmail topics:", error);
    return c.json({ error: "Failed to get topics" }, 500);
  }
});

/**
 * DELETE /api/gmail/reset
 * Reset all Gmail sync data (for testing)
 */
gmailRouter.delete("/reset", async (c) => {
  const db = c.env.DB;
  
  try {
    // Delete Gmail-specific data
    await db.prepare("DELETE FROM gmail_processed_emails").run();
    await db.prepare("DELETE FROM insight_topics WHERE insight_id LIKE 'gmail_%'").run();
    await db.prepare("DELETE FROM insights WHERE user_id = ?").bind(GMAIL_USER_ID).run();
    await db.prepare("DELETE FROM conversation_topics WHERE conversation_id LIKE 'gmail_%'").run();
    await db.prepare("DELETE FROM conversations WHERE user_id = ?").bind(GMAIL_USER_ID).run();
    await db.prepare("DELETE FROM global_insights WHERE id LIKE 'gmail_%'").run();
    await db.prepare("DELETE FROM topics WHERE name LIKE 'gmail-%'").run();
    
    return c.json({
      success: true,
      message: "Gmail sync data reset",
    });
  } catch (error) {
    console.error("Error resetting Gmail data:", error);
    return c.json({ error: "Failed to reset" }, 500);
  }
});

export default gmailRouter;
