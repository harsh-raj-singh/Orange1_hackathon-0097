import { Hono } from "hono";
import { createGraphService } from "../services/graph";
import type { Env } from "../types";

const graphRouter = new Hono<{ Bindings: Env }>();

/**
 * GET /api/graph/user/:userId/map
 * Get user's knowledge graph for visualization
 */
graphRouter.get("/user/:userId/map", async (c) => {
  const userId = c.req.param("userId");
  const graph = createGraphService(c.env.DB);

  try {
    const knowledgeMap = await graph.getUserKnowledgeMap(userId);
    return c.json(knowledgeMap);
  } catch (error) {
    console.error("Graph map error:", error);
    return c.json({ error: "Failed to fetch knowledge map" }, 500);
  }
});

/**
 * GET /api/graph/user/:userId/topics
 * Get all topics a user has explored
 */
graphRouter.get("/user/:userId/topics", async (c) => {
  const userId = c.req.param("userId");
  const graph = createGraphService(c.env.DB);

  try {
    const conversations = await graph.getUserConversations(userId, 100);
    const allTopics = [...new Set(conversations.flatMap(c => c.topics))];
    
    return c.json({ 
      topics: allTopics,
      count: allTopics.length 
    });
  } catch (error) {
    console.error("Topics error:", error);
    return c.json({ error: "Failed to fetch topics" }, 500);
  }
});

/**
 * GET /api/graph/global
 * Get the ENTIRE global knowledge graph (all users, all topics)
 * Now includes GLOBAL FREQUENCY for hierarchical node sizing
 */
graphRouter.get("/global", async (c) => {
  const db = c.env.DB;

  // Prevent caching
  c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  c.header('Pragma', 'no-cache');
  c.header('Expires', '0');

  try {
    // Get all topics WITH GLOBAL FREQUENCY (how many conversations use each topic)
    const topicsResult = await db.prepare(`
      SELECT 
        t.id, 
        t.name, 
        t.description,
        COUNT(DISTINCT ct.conversation_id) as global_frequency,
        (SELECT COUNT(*) FROM topic_relations WHERE source_topic_id = t.id OR target_topic_id = t.id) as connection_count
      FROM topics t
      LEFT JOIN conversation_topics ct ON t.id = ct.topic_id
      GROUP BY t.id
      ORDER BY global_frequency DESC, t.name
    `).all();

    // Get all topic relations
    const relationsResult = await db.prepare(`
      SELECT 
        t1.name as source,
        t2.name as target,
        tr.strength,
        tr.relation_type as type
      FROM topic_relations tr
      JOIN topics t1 ON tr.source_topic_id = t1.id
      JOIN topics t2 ON tr.target_topic_id = t2.id
      ORDER BY tr.strength DESC
    `).all();

    // Get all insights with their topics
    const insightsResult = await db.prepare(`
      SELECT 
        i.id,
        i.content,
        i.user_id,
        i.created_at,
        GROUP_CONCAT(t.name) as topics
      FROM insights i
      LEFT JOIN insight_topics it ON i.id = it.insight_id
      LEFT JOIN topics t ON it.topic_id = t.id
      GROUP BY i.id
      ORDER BY i.created_at DESC
      LIMIT 50
    `).all();

    // Get conversation summaries
    const conversationsResult = await db.prepare(`
      SELECT 
        c.id,
        c.user_id,
        c.summary,
        c.message_count,
        c.created_at,
        GROUP_CONCAT(t.name) as topics
      FROM conversations c
      LEFT JOIN conversation_topics ct ON c.id = ct.conversation_id
      LEFT JOIN topics t ON ct.topic_id = t.id
      GROUP BY c.id
      ORDER BY c.created_at DESC
      LIMIT 20
    `).all();

    // Calculate max frequency for normalization
    const maxFrequency = Math.max(...(topicsResult.results || []).map((t: any) => t.global_frequency || 1), 1);

    // Build graph data for visualization with frequency
    const nodes = (topicsResult.results || []).map((t: any) => ({
      id: t.name,
      label: t.name.replace(/-/g, ' '),
      type: 'topic',
      frequency: t.global_frequency || 1,
      connections: t.connection_count || 0,
      // Normalized frequency (0-1) for client-side sizing
      normalizedFrequency: (t.global_frequency || 1) / maxFrequency
    }));

    const edges = (relationsResult.results || []).map((r: any) => ({
      source: r.source,
      target: r.target,
      strength: r.strength,
      type: r.type
    }));

    return c.json({
      stats: {
        totalTopics: nodes.length,
        totalConnections: edges.length,
        totalInsights: insightsResult.results?.length || 0,
        totalConversations: conversationsResult.results?.length || 0,
        maxFrequency // Send max for reference
      },
      graph: { nodes, edges },
      topics: topicsResult.results,
      relations: relationsResult.results,
      insights: (insightsResult.results || []).map((i: any) => ({
        ...i,
        topics: i.topics ? i.topics.split(',') : []
      })),
      conversations: (conversationsResult.results || []).map((c: any) => ({
        ...c,
        topics: c.topics ? c.topics.split(',') : []
      }))
    });
  } catch (error) {
    console.error("Global graph error:", error);
    return c.json({ error: "Failed to fetch global graph" }, 500);
  }
});

/**
 * GET /api/graph/user/:userId/full
 * Get complete user knowledge data (topics, insights, conversations)
 * Now includes USER-SPECIFIC FREQUENCY for hierarchical node sizing
 */
graphRouter.get("/user/:userId/full", async (c) => {
  const userId = c.req.param("userId");
  const db = c.env.DB;

  // Prevent caching
  c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  c.header('Pragma', 'no-cache');
  c.header('Expires', '0');

  try {
    // Get user's conversations
    const conversationsResult = await db.prepare(`
      SELECT 
        c.id,
        c.summary,
        c.message_count,
        c.created_at,
        c.is_useful,
        c.usefulness_reason,
        c.processed,
        GROUP_CONCAT(DISTINCT t.name) as topics
      FROM conversations c
      LEFT JOIN conversation_topics ct ON c.id = ct.conversation_id
      LEFT JOIN topics t ON ct.topic_id = t.id
      WHERE c.user_id = ?
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `).bind(userId).all();

    // Get user's insights
    const insightsResult = await db.prepare(`
      SELECT 
        i.id,
        i.content,
        i.importance_score,
        i.created_at,
        GROUP_CONCAT(DISTINCT t.name) as topics
      FROM insights i
      LEFT JOIN insight_topics it ON i.id = it.insight_id
      LEFT JOIN topics t ON it.topic_id = t.id
      WHERE i.user_id = ?
      GROUP BY i.id
      ORDER BY i.created_at DESC
    `).bind(userId).all();

    // Get user's topics WITH USER-SPECIFIC FREQUENCY (how many of USER'S conversations use each topic)
    const topicsResult = await db.prepare(`
      SELECT 
        t.name, 
        t.id,
        COUNT(DISTINCT c.id) as user_frequency,
        (SELECT COUNT(*) FROM topic_relations WHERE source_topic_id = t.id OR target_topic_id = t.id) as connection_count
      FROM conversations c
      JOIN conversation_topics ct ON c.id = ct.conversation_id
      JOIN topics t ON ct.topic_id = t.id
      WHERE c.user_id = ?
      GROUP BY t.id
      ORDER BY user_frequency DESC, connection_count DESC
    `).bind(userId).all();

    // Get topic relationships for this user's topics
    const topicIds = (topicsResult.results || []).map((t: any) => `'${t.id}'`).join(',');
    
    let relationsResult = { results: [] };
    if (topicIds) {
      relationsResult = await db.prepare(`
        SELECT 
          t1.name as source,
          t2.name as target,
          tr.strength
        FROM topic_relations tr
        JOIN topics t1 ON tr.source_topic_id = t1.id
        JOIN topics t2 ON tr.target_topic_id = t2.id
        WHERE tr.source_topic_id IN (${topicIds}) OR tr.target_topic_id IN (${topicIds})
      `).all();
    }

    // Calculate max frequency for this user for normalization
    const maxFrequency = Math.max(...(topicsResult.results || []).map((t: any) => t.user_frequency || 1), 1);

    // Build visualization data with frequency
    const nodes = (topicsResult.results || []).map((t: any) => ({
      id: t.name,
      label: t.name.replace(/-/g, ' '),
      connections: t.connection_count,
      frequency: t.user_frequency || 1,
      normalizedFrequency: (t.user_frequency || 1) / maxFrequency,
      type: 'topic'
    }));

    const edges = (relationsResult.results || []).map((r: any) => ({
      source: r.source,
      target: r.target,
      strength: r.strength
    }));

    return c.json({
      userId,
      stats: {
        conversations: conversationsResult.results?.length || 0,
        insights: insightsResult.results?.length || 0,
        topics: topicsResult.results?.length || 0,
        connections: relationsResult.results?.length || 0,
        maxFrequency
      },
      graph: { nodes, edges },
      conversations: (conversationsResult.results || []).map((c: any) => ({
        ...c,
        topics: c.topics ? c.topics.split(',') : []
      })),
      insights: (insightsResult.results || []).map((i: any) => ({
        ...i,
        topics: i.topics ? i.topics.split(',') : []
      })),
      topics: topicsResult.results
    });
  } catch (error) {
    console.error("User full graph error:", error);
    return c.json({ error: "Failed to fetch user graph" }, 500);
  }
});

/**
 * GET /api/graph/suggestions
 * Get topic suggestions based on current context
 */
graphRouter.get("/suggestions", async (c) => {
  const topics = c.req.query("topics")?.split(",").filter(Boolean) || [];
  const limit = parseInt(c.req.query("limit") || "5");

  const graph = createGraphService(c.env.DB);

  try {
    const suggestions = await graph.getSuggestedTopics(topics, limit);
    return c.json({ suggestions });
  } catch (error) {
    console.error("Suggestions error:", error);
    return c.json({ error: "Failed to get suggestions" }, 500);
  }
});

/**
 * POST /api/graph/link-topics
 * Manually link two topics (admin/debug)
 */
graphRouter.post("/link-topics", async (c) => {
  const { topic1, topic2, strength = 0.5 } = await c.req.json();

  if (!topic1 || !topic2) {
    return c.json({ error: "Both topic1 and topic2 are required" }, 400);
  }

  const graph = createGraphService(c.env.DB);

  try {
    await graph.linkTopics(topic1, topic2, strength);
    return c.json({ success: true, message: `Linked ${topic1} <-> ${topic2}` });
  } catch (error) {
    console.error("Link topics error:", error);
    return c.json({ error: "Failed to link topics" }, 500);
  }
});

export default graphRouter;
