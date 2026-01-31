import { Hono } from "hono";
import { createVectorService } from "../services/vector";
import { createGraphService } from "../services/graph";
import type { Env } from "../types";

const knowledgeRouter = new Hono<{ Bindings: Env }>();

/**
 * POST /api/knowledge/search
 * Semantic search across user's knowledge base
 */
knowledgeRouter.post("/search", async (c) => {
  const { query, userId, limit = 5 } = await c.req.json();

  if (!query) {
    return c.json({ error: "Query is required" }, 400);
  }

  const vector = createVectorService(
    c.env.UPSTASH_VECTOR_REST_URL,
    c.env.UPSTASH_VECTOR_REST_TOKEN
  );

  try {
    const results = await vector.searchSimilar(query, userId, limit);
    return c.json({ results });
  } catch (error) {
    console.error("Search error:", error);
    return c.json({ error: "Failed to search knowledge base" }, 500);
  }
});

/**
 * POST /api/knowledge/add
 * Manually add an insight to the knowledge base
 */
knowledgeRouter.post("/add", async (c) => {
  const { userId, content, topics = [], conversationId } = await c.req.json();

  if (!userId || !content) {
    return c.json({ error: "userId and content are required" }, 400);
  }

  const vector = createVectorService(
    c.env.UPSTASH_VECTOR_REST_URL,
    c.env.UPSTASH_VECTOR_REST_TOKEN
  );
  const graph = createGraphService(c.env.DB);

  try {
    // Create a conversation if not provided
    const convId = conversationId || await graph.createConversation(userId);

    // Save to graph DB
    const insightId = await graph.saveInsight(userId, convId, content, topics);

    // Save to vector DB
    await vector.storeInsight(insightId, content, userId, topics);

    return c.json({ 
      success: true, 
      insightId,
      conversationId: convId 
    });
  } catch (error) {
    console.error("Add insight error:", error);
    return c.json({ error: "Failed to add insight" }, 500);
  }
});

/**
 * DELETE /api/knowledge/:insightId
 * Delete an insight from knowledge base
 */
knowledgeRouter.delete("/:insightId", async (c) => {
  const insightId = c.req.param("insightId");

  const vector = createVectorService(
    c.env.UPSTASH_VECTOR_REST_URL,
    c.env.UPSTASH_VECTOR_REST_TOKEN
  );

  try {
    await vector.deleteInsight(insightId);
    // Note: Graph deletion would require additional implementation
    return c.json({ success: true });
  } catch (error) {
    console.error("Delete insight error:", error);
    return c.json({ error: "Failed to delete insight" }, 500);
  }
});

/**
 * GET /api/knowledge/stats/:userId
 * Get knowledge base statistics for a user
 */
knowledgeRouter.get("/stats/:userId", async (c) => {
  const userId = c.req.param("userId");
  const graph = createGraphService(c.env.DB);

  try {
    const conversations = await graph.getUserConversations(userId, 1000);
    const knowledgeMap = await graph.getUserKnowledgeMap(userId);

    return c.json({
      totalConversations: conversations.length,
      totalTopics: knowledgeMap.nodes.length,
      totalConnections: knowledgeMap.edges.length,
      topTopics: knowledgeMap.nodes.slice(0, 5).map(n => n.label),
    });
  } catch (error) {
    console.error("Stats error:", error);
    return c.json({ error: "Failed to fetch stats" }, 500);
  }
});

export default knowledgeRouter;
