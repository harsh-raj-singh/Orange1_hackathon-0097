import { Hono } from "hono";
import { createLLMService } from "../services/llm";
import { createVectorService } from "../services/vector";
import { createGraphService } from "../services/graph";
import type { Env, ChatRequest, ChatResponse, ChatMessage, PIIDetection } from "../types";

const chatRouter = new Hono<{ Bindings: Env }>();

/**
 * POST /api/chat/send
 * Main chat endpoint with knowledge graph context
 * Now with:
 * - Trivial query detection (shorter responses)
 * - NO immediate graph storage (deferred to background processor)
 */
chatRouter.post("/send", async (c) => {
  const body = await c.req.json<ChatRequest>();
  const { userId, conversationId, messages, globalSharingConsent } = body;

  const llm = createLLMService(c.env.AI_GATEWAY_BASE_URL, c.env.AI_GATEWAY_API_KEY);
  const graph = createGraphService(c.env.DB);
  const vector = createVectorService(
    c.env.UPSTASH_VECTOR_REST_URL,
    c.env.UPSTASH_VECTOR_REST_TOKEN
  );

  try {
    // 1. Get user's last message
    const userQuery = messages[messages.length - 1]?.content || "";

    // 2. Classify the query (trivial vs meaningful)
    const queryClass = await llm.classifyQuery(userQuery);

    // 3. Check if this conversation is already blocked from global sharing
    let isGlobalSharingBlocked = false;
    if (conversationId) {
      isGlobalSharingBlocked = await graph.isConversationGlobalSharingBlocked(conversationId);
    }

    // 4. Build context from D1 database (primary source)
    let contextParts: string[] = [];
    
    // Get user's insights from graph DB (for full memory)
    const recentInsights = await graph.getRecentUserInsights(userId, 15);
    if (recentInsights.length > 0) {
      contextParts.push("**Your previous knowledge (from your past conversations):**");
      for (const insight of recentInsights) {
        contextParts.push(`- ${insight.content} (Topics: ${insight.topics.join(", ")})`);
      }
    }

    // 5. Get GLOBAL knowledge from all users
    const globalInsights = await graph.getGlobalInsights(25);
    const globalSummaries = await graph.getGlobalConversationSummaries(15);
    
    const otherUsersInsights = globalInsights.filter(i => i.userId !== userId);
    const otherUsersSummaries = globalSummaries.filter(s => s.userId !== userId);
    
    if (otherUsersInsights.length > 0 || otherUsersSummaries.length > 0) {
      contextParts.push("\n**Global knowledge (from all users' conversations):**");
      
      for (const summary of otherUsersSummaries) {
        contextParts.push(`- ${summary.summary} (Topics: ${summary.topics.join(", ")})`);
      }
      
      for (const insight of otherUsersInsights.slice(0, 15)) {
        contextParts.push(`- ${insight.content} (Topics: ${insight.topics.join(", ")})`);
      }
    }

    // 6. Get user's topics to find related insights
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

    // 7. Try vector search as secondary source
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
    } catch {
      console.log("Vector search unavailable, using graph context only");
    }

    const contextString = contextParts.length > 0 ? contextParts.join("\n") : undefined;

    // 8. Generate LLM response with context and appropriate length
    const response = await llm.chat(
      messages, 
      contextString,
      queryClass.suggestedResponseLength
    );

    // 9. Create or use existing conversation
    const convId = conversationId || await graph.createConversation(userId);

    // 10. Save messages to database (always save for history)
    await graph.addMessage(convId, "user", userQuery);
    await graph.addMessage(convId, "assistant", response);

    // 11. Update conversation's last activity timestamp
    await graph.updateConversationActivity(convId);

    // 12. Detect PII in the conversation
    let piiDetection: PIIDetection | undefined;
    if (!isGlobalSharingBlocked && !queryClass.isTrivial) {
      const piiResult = await llm.detectPII(userQuery, response);
      if (piiResult.containsPII) {
        piiDetection = {
          detected: true,
          types: piiResult.piiTypes,
          explanation: piiResult.explanation,
        };
        
        if (globalSharingConsent === false) {
          await graph.setConversationGlobalSharingBlocked(convId, true);
          isGlobalSharingBlocked = true;
        }
      }
    }

    // 13. NOTE: NO immediate insight extraction!
    // The background processor will analyze the conversation after 2 minutes of inactivity
    // This allows multi-turn conversations to be processed as a whole

    // 14. Get suggested topics from user's existing knowledge
    let suggestedTopics = userTopics.slice(0, 3);

    // 15. Return response
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
      extractedInsights: [], // Will be populated by background processor
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
 * POST /api/chat/stream
 * Streaming chat endpoint - returns SSE stream
 */
chatRouter.post("/stream", async (c) => {
  const body = await c.req.json<ChatRequest>();
  const { userId, conversationId, messages } = body;

  const llm = createLLMService(c.env.AI_GATEWAY_BASE_URL, c.env.AI_GATEWAY_API_KEY);
  const graph = createGraphService(c.env.DB);
  const vector = createVectorService(
    c.env.UPSTASH_VECTOR_REST_URL,
    c.env.UPSTASH_VECTOR_REST_TOKEN
  );

  try {
    // 1. Get user's last message
    const userQuery = messages[messages.length - 1]?.content || "";

    // 2. Classify the query
    const queryClass = await llm.classifyQuery(userQuery);

    // 3. Build context (same as /send endpoint)
    let contextParts: string[] = [];
    
    const recentInsights = await graph.getRecentUserInsights(userId, 15);
    if (recentInsights.length > 0) {
      contextParts.push("**Your previous knowledge (from your past conversations):**");
      for (const insight of recentInsights) {
        contextParts.push(`- ${insight.content} (Topics: ${insight.topics.join(", ")})`);
      }
    }

    const globalInsights = await graph.getGlobalInsights(25);
    const globalSummaries = await graph.getGlobalConversationSummaries(15);
    
    const otherUsersInsights = globalInsights.filter(i => i.userId !== userId);
    const otherUsersSummaries = globalSummaries.filter(s => s.userId !== userId);
    
    if (otherUsersInsights.length > 0 || otherUsersSummaries.length > 0) {
      contextParts.push("\n**Global knowledge (from all users' conversations):**");
      for (const summary of otherUsersSummaries) {
        contextParts.push(`- ${summary.summary} (Topics: ${summary.topics.join(", ")})`);
      }
      for (const insight of otherUsersInsights.slice(0, 15)) {
        contextParts.push(`- ${insight.content} (Topics: ${insight.topics.join(", ")})`);
      }
    }

    // Vector search
    try {
      const vectorResults = await vector.searchSimilar(userQuery, userId, 3);
      if (vectorResults.length > 0) {
        contextParts.push("\n**Semantically related insights:**");
        for (const result of vectorResults) {
          if (result.score > 0.5) {
            contextParts.push(`- ${result.content}`);
          }
        }
      }
    } catch {
      // Vector search unavailable
    }

    const contextString = contextParts.length > 0 ? contextParts.join("\n") : undefined;

    // 4. Create or get conversation ID
    const convId = conversationId || await graph.createConversation(userId);

    // 5. Save user message immediately
    await graph.addMessage(convId, "user", userQuery);

    // 6. Stream the response
    const result = llm.chatStream(messages, contextString, queryClass.suggestedResponseLength);
    
    // Collect full response for saving
    let fullResponse = "";
    
    // Create a TransformStream to capture the response while streaming
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Process the stream
    (async () => {
      try {
        for await (const chunk of result.textStream) {
          fullResponse += chunk;
          // Send SSE format
          await writer.write(encoder.encode(`data: ${JSON.stringify({ text: chunk, conversationId: convId })}\n\n`));
        }
        
        // Save the complete response
        await graph.addMessage(convId, "assistant", fullResponse);
        await graph.updateConversationActivity(convId);
        
        // Send done signal
        await writer.write(encoder.encode(`data: ${JSON.stringify({ done: true, conversationId: convId })}\n\n`));
        await writer.close();
      } catch (error) {
        console.error("Stream error:", error);
        await writer.write(encoder.encode(`data: ${JSON.stringify({ error: "Stream failed" })}\n\n`));
        await writer.close();
      }
    })();

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });

  } catch (error) {
    console.error("Stream chat error:", error);
    return c.json({ error: "Failed to start stream", details: String(error) }, 500);
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
    if (!consent) {
      await graph.setConversationGlobalSharingBlocked(conversationId, true);
    }
    
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
 * GET /api/chat/status/:conversationId
 * Get the processing status of a conversation (for visual feedback)
 */
chatRouter.get("/status/:conversationId", async (c) => {
  const conversationId = c.req.param("conversationId");
  const db = c.env.DB;

  try {
    const result = await db.prepare(`
      SELECT 
        id, 
        processed, 
        is_useful, 
        usefulness_reason,
        updated_at
      FROM conversations 
      WHERE id = ?
    `).bind(conversationId).first();

    if (!result) {
      return c.json({ error: "Conversation not found" }, 404);
    }

    // Check if there are processing logs for this conversation
    const log = await db.prepare(`
      SELECT 
        processed_at,
        is_useful,
        reason,
        topics_extracted,
        insights_count
      FROM conversation_processing_logs
      WHERE conversation_id = ?
      ORDER BY processed_at DESC
      LIMIT 1
    `).bind(conversationId).first();

    return c.json({
      conversationId,
      processed: result.processed === 1,
      isUseful: result.is_useful === 1,
      usefulnessReason: result.usefulness_reason || null,
      processingLog: log ? {
        processedAt: new Date((log.processed_at as number) * 1000).toISOString(),
        isUseful: log.is_useful === 1,
        reason: log.reason,
        topicsExtracted: JSON.parse((log.topics_extracted as string) || "[]"),
        insightsCount: log.insights_count
      } : null
    });
  } catch (error) {
    console.error("Status error:", error);
    return c.json({ error: "Failed to get status" }, 500);
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

/**
 * DELETE /api/chat/:conversationId
 * Delete a conversation from user's graph (keeps in global)
 * - Removes from user's view and personal graph
 * - Anonymizes insights (keeps in global graph)
 * - Messages remain in DB for data integrity
 */
chatRouter.delete("/:conversationId", async (c) => {
  const conversationId = c.req.param("conversationId");
  const { userId } = await c.req.json<{ userId: string }>();

  if (!userId) {
    return c.json({ error: "userId is required" }, 400);
  }

  const graph = createGraphService(c.env.DB);

  try {
    const result = await graph.deleteConversationFromUserGraph(conversationId, userId);
    
    if (!result.deleted) {
      return c.json({ error: "Conversation not found or not owned by user" }, 404);
    }

    return c.json({ 
      success: true, 
      message: "Conversation deleted from your view",
      insightsAnonymized: result.insightsAnonymized
    });
  } catch (error) {
    console.error("Delete conversation error:", error);
    return c.json({ error: "Failed to delete conversation" }, 500);
  }
});

export default chatRouter;
