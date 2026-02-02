import { Hono } from "hono";
import type { Env } from "../types";
import { createLLMService } from "../services/llm";
import {
  processStaleConversations,
  getRecentProcessingLogs,
  findStaleConversations,
} from "../services/conversation-processor";

const processorRouter = new Hono<{ Bindings: Env }>();

/**
 * POST /api/processor/run
 * Manually trigger the background processor
 * In production, this would be called by a cron job every 2 minutes
 */
processorRouter.post("/run", async (c) => {
  const db = c.env.DB;
  const llm = createLLMService(c.env.AI_GATEWAY_BASE_URL, c.env.AI_GATEWAY_API_KEY);
  
  try {
    const result = await processStaleConversations(db, llm);
    
    return c.json({
      success: true,
      message: `Processed ${result.processed} conversations`,
      stats: {
        processed: result.processed,
        useful: result.useful,
        notUseful: result.notUseful,
      },
      results: result.results.map(r => ({
        conversationId: r.conversationId,
        isUseful: r.isUseful,
        reason: r.reason,
        topicsCreated: r.topicsCreated,
        insightsCreated: r.insightsCreated,
      })),
    });
  } catch (error) {
    console.error("Processor error:", error);
    return c.json({ error: "Failed to run processor", details: String(error) }, 500);
  }
});

/**
 * GET /api/processor/pending
 * Check how many conversations are pending processing
 */
processorRouter.get("/pending", async (c) => {
  const db = c.env.DB;
  
  try {
    const stale = await findStaleConversations(db);
    
    // Also get count of all unprocessed
    const totalPending = await db.prepare(`
      SELECT COUNT(*) as count FROM conversations WHERE processed = 0
    `).first<{ count: number }>();
    
    return c.json({
      success: true,
      staleReady: stale.length, // Ready to process now
      totalPending: totalPending?.count || 0, // All unprocessed (including recent)
      staleConversations: stale.map(s => ({
        id: s.id,
        userId: s.user_id,
        messageCount: s.message_count,
        lastActivity: new Date(s.updated_at * 1000).toISOString(),
      })),
    });
  } catch (error) {
    return c.json({ error: "Failed to get pending" }, 500);
  }
});

/**
 * GET /api/processor/logs
 * Get recent processing logs for visibility
 */
processorRouter.get("/logs", async (c) => {
  const db = c.env.DB;
  const limit = parseInt(c.req.query("limit") || "20");
  
  try {
    const logs = await getRecentProcessingLogs(db, limit);
    
    return c.json({
      success: true,
      logs: logs.map(log => ({
        id: log.id,
        conversationId: log.conversation_id,
        userId: log.user_id,
        processedAt: new Date(log.processed_at * 1000).toISOString(),
        isUseful: log.is_useful,
        reason: log.reason,
        topicsExtracted: log.topics_extracted,
        insightsCount: log.insights_count,
      })),
    });
  } catch (error) {
    return c.json({ error: "Failed to get logs" }, 500);
  }
});

/**
 * GET /api/processor/stats
 * Get overall processing statistics
 */
processorRouter.get("/stats", async (c) => {
  const db = c.env.DB;
  
  try {
    const [processed, useful, pending, recentLogs] = await Promise.all([
      db.prepare("SELECT COUNT(*) as count FROM conversations WHERE processed = 1").first<{ count: number }>(),
      db.prepare("SELECT COUNT(*) as count FROM conversations WHERE is_useful = 1").first<{ count: number }>(),
      db.prepare("SELECT COUNT(*) as count FROM conversations WHERE processed = 0").first<{ count: number }>(),
      db.prepare("SELECT COUNT(*) as count FROM conversation_processing_logs WHERE processed_at > ?")
        .bind(Math.floor(Date.now() / 1000) - 3600) // Last hour
        .first<{ count: number }>(),
    ]);
    
    return c.json({
      success: true,
      stats: {
        totalProcessed: processed?.count || 0,
        totalUseful: useful?.count || 0,
        totalPending: pending?.count || 0,
        processedLastHour: recentLogs?.count || 0,
        usefulRate: processed?.count 
          ? ((useful?.count || 0) / processed.count * 100).toFixed(1) + "%" 
          : "N/A",
      },
    });
  } catch (error) {
    return c.json({ error: "Failed to get stats" }, 500);
  }
});

export default processorRouter;
