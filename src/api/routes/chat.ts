import { Hono } from "hono";
import { createLLMService } from "../services/llm";
import { createVectorService } from "../services/vector";
import { createGraphService } from "../services/graph";
import type { Env, ChatRequest, ChatResponse, ChatMessage, PIIDetection } from "../types";

const chatRouter = new Hono<{ Bindings: Env }>();

/**
 * POST /api/chat/send
 * Main chat endpoint with knowledge graph context
 */
chatRouter.post("/send", async (c) => {
  const body = await c.req.json<ChatRequest>();
  const { userId, conversationId, messages, saveInsights = true, globalSharingConsent } = body;

  // Initialize services
  const llm = createLLMService(c.env.AI_GATEWAY_BASE_URL, c.env.AI_GATEWAY_API_KEY);
  const graph = createGraphService(c.env.DB);
  const vector = createVectorService(
    c.env.UPSTASH_VECTOR_REST_URL,
    c.env.UPSTASH_VECTOR_REST_TOKEN
  );

  try {
    // 1. Get user's last message
    const userQuery = messages[messages.length - 1]?.content || "";

    // 2. Check if this conversation is already blocked from global sharing
    let isGlobalSharingBlocked = false;
    if (conversationId) {
      isGlobalSharingBlocked = await graph.isConversationGlobalSharingBlocked(conversationId);
    }

    // 3. Build context from D1 database (primary source)
    let contextParts: string[] = [];
    
    // Get ALL user's insights from graph DB (for full memory)
    const recentInsights = await graph.getRecentUserInsights(userId, 15);
    if (recentInsights.length > 0) {
      contextParts.push("**Your previous knowledge (from your past conversations):**");
      for (const insight of recentInsights) {
        contextParts.push(`- ${insight.content} (Topics: ${insight.topics.join(", ")})`);
      }
    }

    // 4. Get GLOBAL knowledge from all users
    const globalInsights = await graph.getGlobalInsights(25);
    const globalSummaries = await graph.getGlobalConversationSummaries(15);
    
    // Filter out current user's insights to avoid duplication
    const otherUsersInsights = globalInsights.filter(i => i.userId !== userId);
    const otherUsersSummaries = globalSummaries.filter(s => s.userId !== userId);
    
    if (otherUsersInsights.length > 0 || otherUsersSummaries.length > 0) {
      contextParts.push("\n**Global knowledge (from all users' conversations):**");
      
      // Add conversation summaries
      for (const summary of otherUsersSummaries) {
        contextParts.push(`- ${summary.summary} (Topics: ${summary.topics.join(", ")})`);
      }
      
      // Add insights
      for (const insight of otherUsersInsights.slice(0, 15)) {
        contextParts.push(`- ${insight.content} (Topics: ${insight.topics.join(", ")})`);
      }
    }

    // 5. Get user's topics to find related insights
    const userTopics = await graph.getAllUserTopics(userId);
    if (userTopics.length > 0) {
      const relatedInsights = await graph.getRelatedInsights(userId, userTopics, 3);
      if (relatedInsights.length > 0 && recentInsights.length === 0) {
        contextParts.push("\n**Related context from your knowledge graph:**");
        for (const insight of relatedInsights) {
          contextParts.push(`- ${insight.content} (Topic: ${insight.topic})`);
        }
      }
    }

    // 6. Try vector search as secondary source (may fail gracefully)
    let vectorResults: Array<{ content: string; topics: string[]; score: number }> = [];
    try {
      vectorResults = await vector.searchSimilar(userQuery, userId, 3);
      if (vectorResults.length > 0) {
        contextParts.push("\n**Semantically related insights:**");
        for (const result of vectorResults) {
          if (result.score > 0.5) {
            contextParts.push(`- ${result.content}`);
          }
        }
      }
    } catch (vectorError) {
      console.log("Vector search unavailable, using graph context only");
    }

    const contextString = contextParts.length > 0 ? contextParts.join("\n") : undefined;

    // 7. Generate LLM response with context
    const response = await llm.chat(messages, contextString);

    // 8. Create or use existing conversation
    const convId = conversationId || await graph.createConversation(userId);

    // 9. Save messages to database
    await graph.addMessage(convId, "user", userQuery);
    await graph.addMessage(convId, "assistant", response);

    // 10. Detect PII in the conversation
    let piiDetection: PIIDetection | undefined;
    if (!isGlobalSharingBlocked) {
      const piiResult = await llm.detectPII(userQuery, response);
      if (piiResult.containsPII) {
        piiDetection = {
          detected: true,
          types: piiResult.piiTypes,
          explanation: piiResult.explanation,
        };
        
        // If user explicitly rejected sharing (globalSharingConsent === false)
        if (globalSharingConsent === false) {
          await graph.setConversationGlobalSharingBlocked(convId, true);
          isGlobalSharingBlocked = true;
        }
        // If user approved (globalSharingConsent === true), keep sharing
        // If user hasn't responded yet (undefined), we'll prompt them in frontend
      }
    }

    // 11. Extract and save insights
    let extractedInsights: string[] = [];
    let suggestedTopics: string[] = [];

    if (saveInsights) {
      // Build conversation text for extraction
      const conversationText = messages
        .map((m: ChatMessage) => `${m.role}: ${m.content}`)
        .join("\n") + `\nassistant: ${response}`;

      // Extract insights
      const extraction = await llm.extractInsights(conversationText);
      extractedInsights = extraction.insights;

      // Save to graph
      if (extraction.topics.length > 0) {
        await graph.linkConversationToTopics(convId, extraction.topics);
      }

      // Save each insight
      for (const insight of extraction.insights) {
        const insightId = await graph.saveInsight(
          userId,
          convId,
          insight,
          extraction.topics
        );

        // Try to store in vector DB (non-blocking)
        try {
          await vector.storeInsight(insightId, insight, userId, extraction.topics);
        } catch {
          // Vector storage failed, but graph storage succeeded
        }
      }

      // Update conversation summary
      if (extraction.summary) {
        await graph.updateConversationSummary(convId, extraction.summary);
      }

      // Get suggested topics from graph
      suggestedTopics = await graph.getSuggestedTopics(extraction.topics);
      
      // If no suggestions from current topics, suggest from user's history
      if (suggestedTopics.length === 0 && userTopics.length > 0) {
        suggestedTopics = userTopics.slice(0, 3);
      }
    }

    // 12. Return response
    const chatResponse: ChatResponse = {
      response,
      conversationId: convId,
      relatedContext: recentInsights.map(r => ({
        content: r.content,
        topic: r.topics[0] || "general",
        score: 1.0,
        source: "graph" as const,
      })),
      suggestedTopics,
      extractedInsights,
      piiDetection,
      globalSharingBlocked: isGlobalSharingBlocked,
    };

    return c.json(chatResponse);

  } catch (error) {
    console.error("Chat error:", error);
    return c.json({ error: "Failed to process chat", details: String(error) }, 500);
  }
});

/**
 * POST /api/chat/pii-consent
 * Handle user's consent decision for global sharing after PII detection
 */
chatRouter.post("/pii-consent", async (c) => {
  const { conversationId, consent } = await c.req.json<{ conversationId: string; consent: boolean }>();

  const graph = createGraphService(c.env.DB);

  try {
    // If user rejects, block the conversation from global sharing
    if (!consent) {
      await graph.setConversationGlobalSharingBlocked(conversationId, true);
    }
    // If user approves, keep it unblocked (default)
    
    return c.json({ success: true, globalSharingBlocked: !consent });
  } catch (error) {
    console.error("PII consent error:", error);
    return c.json({ error: "Failed to update consent" }, 500);
  }
});

/**
 * GET /api/chat/history/:userId
 * Get user's conversation history
 */
chatRouter.get("/history/:userId", async (c) => {
  const userId = c.req.param("userId");
  const limit = parseInt(c.req.query("limit") || "10");

  const graph = createGraphService(c.env.DB);

  try {
    const conversations = await graph.getUserConversations(userId, limit);
    return c.json({ conversations });
  } catch (error) {
    console.error("History error:", error);
    return c.json({ error: "Failed to fetch history" }, 500);
  }
});

/**
 * GET /api/chat/context/:userId
 * Get user's current knowledge context (for debugging)
 */
chatRouter.get("/context/:userId", async (c) => {
  const userId = c.req.param("userId");
  const graph = createGraphService(c.env.DB);

  try {
    const recentInsights = await graph.getRecentUserInsights(userId, 10);
    const topics = await graph.getAllUserTopics(userId);
    const conversations = await graph.getUserConversations(userId, 5);

    return c.json({
      userId,
      insightCount: recentInsights.length,
      topicCount: topics.length,
      conversationCount: conversations.length,
      recentInsights,
      topics,
      conversations: conversations.map(c => ({ id: c.id, summary: c.summary })),
    });
  } catch (error) {
    console.error("Context error:", error);
    return c.json({ error: "Failed to fetch context" }, 500);
  }
});

/**
 * POST /api/chat/simple
 * Simple chat without knowledge graph (for testing)
 */
chatRouter.post("/simple", async (c) => {
  const { messages } = await c.req.json<{ messages: ChatMessage[] }>();

  const llm = createLLMService(c.env.AI_GATEWAY_BASE_URL, c.env.AI_GATEWAY_API_KEY);

  try {
    const response = await llm.chat(messages);
    return c.json({ response });
  } catch (error) {
    console.error("Simple chat error:", error);
    return c.json({ error: "Failed to generate response" }, 500);
  }
});

export default chatRouter;
