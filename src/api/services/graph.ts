import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../database/schema";
import type { KnowledgeMap, GraphNode, GraphEdge } from "../types";

export class GraphService {
  private db: ReturnType<typeof drizzle>;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  // ============ USER OPERATIONS ============

  async getOrCreateUser(userId: string): Promise<schema.User> {
    const existing = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .get();

    if (existing) return existing;

    await this.db.insert(schema.users).values({ id: userId });
    return { id: userId, createdAt: new Date(), consentGlobal: false };
  }

  // ============ TOPIC OPERATIONS ============

  async getOrCreateTopic(name: string): Promise<schema.Topic> {
    const normalizedName = name.toLowerCase().trim().replace(/\s+/g, "-");
    
    const existing = await this.db
      .select()
      .from(schema.topics)
      .where(eq(schema.topics.name, normalizedName))
      .get();

    if (existing) return existing;

    const id = `topic_${crypto.randomUUID().slice(0, 8)}`;
    await this.db.insert(schema.topics).values({
      id,
      name: normalizedName,
    });

    return { id, name: normalizedName, description: null, createdAt: new Date() };
  }

  async linkTopics(topic1Name: string, topic2Name: string, strength: number = 0.5): Promise<void> {
    const topic1 = await this.getOrCreateTopic(topic1Name);
    const topic2 = await this.getOrCreateTopic(topic2Name);

    // Check if relation exists
    const existing = await this.db
      .select()
      .from(schema.topicRelations)
      .where(
        and(
          eq(schema.topicRelations.sourceTopicId, topic1.id),
          eq(schema.topicRelations.targetTopicId, topic2.id)
        )
      )
      .get();

    if (existing) {
      // Strengthen the connection
      await this.db
        .update(schema.topicRelations)
        .set({ strength: Math.min(1, existing.strength! + 0.1) })
        .where(eq(schema.topicRelations.id, existing.id));
    } else {
      // Create new relation
      await this.db.insert(schema.topicRelations).values({
        id: `rel_${crypto.randomUUID().slice(0, 8)}`,
        sourceTopicId: topic1.id,
        targetTopicId: topic2.id,
        strength,
      });
    }
  }

  // ============ CONVERSATION OPERATIONS ============

  async createConversation(userId: string, conversationId?: string): Promise<string> {
    const id = conversationId || `conv_${crypto.randomUUID().slice(0, 8)}`;
    
    await this.getOrCreateUser(userId);
    
    await this.db.insert(schema.conversations).values({
      id,
      userId,
    });

    return id;
  }

  async addMessage(
    conversationId: string,
    role: "user" | "assistant",
    content: string
  ): Promise<string> {
    const id = `msg_${crypto.randomUUID().slice(0, 8)}`;
    
    await this.db.insert(schema.messages).values({
      id,
      conversationId,
      role,
      content,
    });

    // Update conversation message count
    await this.db
      .update(schema.conversations)
      .set({ 
        messageCount: sql`${schema.conversations.messageCount} + 1`,
        updatedAt: new Date()
      })
      .where(eq(schema.conversations.id, conversationId));

    return id;
  }

  async updateConversationActivity(conversationId: string): Promise<void> {
    await this.db
      .update(schema.conversations)
      .set({ updatedAt: new Date() })
      .where(eq(schema.conversations.id, conversationId));
  }

  async updateConversationSummary(conversationId: string, summary: string): Promise<void> {
    await this.db
      .update(schema.conversations)
      .set({ summary })
      .where(eq(schema.conversations.id, conversationId));
  }

  async linkConversationToTopics(conversationId: string, topicNames: string[]): Promise<void> {
    for (const topicName of topicNames) {
      const topic = await this.getOrCreateTopic(topicName);
      
      try {
        await this.db.insert(schema.conversationTopics).values({
          conversationId,
          topicId: topic.id,
        });
      } catch {
        // Ignore duplicate errors
      }
    }

    // Also link topics to each other
    for (let i = 0; i < topicNames.length; i++) {
      for (let j = i + 1; j < topicNames.length; j++) {
        await this.linkTopics(topicNames[i], topicNames[j]);
      }
    }
  }

  // ============ INSIGHT OPERATIONS ============

  async saveInsight(
    userId: string,
    conversationId: string,
    content: string,
    topics: string[],
    embeddingId?: string
  ): Promise<string> {
    const id = `ins_${crypto.randomUUID().slice(0, 8)}`;

    await this.db.insert(schema.insights).values({
      id,
      conversationId,
      userId,
      content,
      embeddingId,
    });

    // Link insight to topics
    for (const topicName of topics) {
      const topic = await this.getOrCreateTopic(topicName);
      try {
        await this.db.insert(schema.insightTopics).values({
          insightId: id,
          topicId: topic.id,
        });
      } catch {
        // Ignore duplicates
      }
    }

    return id;
  }

  // ============ CONTEXT RETRIEVAL ============

  async getRelatedInsights(userId: string, topicNames: string[], limit: number = 5): Promise<Array<{
    content: string;
    topic: string;
  }>> {
    // Get topic IDs
    const topics = await this.db
      .select()
      .from(schema.topics)
      .where(inArray(schema.topics.name, topicNames.map(t => t.toLowerCase().trim().replace(/\s+/g, "-"))));

    if (topics.length === 0) return [];

    const topicIds = topics.map(t => t.id);

    // Get insights linked to these topics for this user
    const results = await this.db
      .select({
        content: schema.insights.content,
        topicId: schema.insightTopics.topicId,
      })
      .from(schema.insights)
      .innerJoin(
        schema.insightTopics,
        eq(schema.insights.id, schema.insightTopics.insightId)
      )
      .where(
        and(
          eq(schema.insights.userId, userId),
          inArray(schema.insightTopics.topicId, topicIds)
        )
      )
      .orderBy(desc(schema.insights.createdAt))
      .limit(limit);

    // Map topic IDs back to names
    const topicMap = new Map(topics.map(t => [t.id, t.name]));

    return results.map(r => ({
      content: r.content,
      topic: topicMap.get(r.topicId) || "unknown",
    }));
  }

  async getSuggestedTopics(currentTopics: string[], limit: number = 3): Promise<string[]> {
    // Get topic IDs for current topics
    const topics = await this.db
      .select()
      .from(schema.topics)
      .where(inArray(schema.topics.name, currentTopics.map(t => t.toLowerCase().trim().replace(/\s+/g, "-"))));

    if (topics.length === 0) return [];

    const topicIds = topics.map(t => t.id);

    // Get related topics through the graph
    const relatedTopics = await this.db
      .select({
        name: schema.topics.name,
        strength: schema.topicRelations.strength,
      })
      .from(schema.topicRelations)
      .innerJoin(
        schema.topics,
        eq(schema.topics.id, schema.topicRelations.targetTopicId)
      )
      .where(inArray(schema.topicRelations.sourceTopicId, topicIds))
      .orderBy(desc(schema.topicRelations.strength))
      .limit(limit);

    return relatedTopics.map(t => t.name);
  }

  // ============ GRAPH VISUALIZATION ============

  async getUserKnowledgeMap(userId: string): Promise<KnowledgeMap> {
    // Get all topics for this user
    const userTopics = await this.db
      .select({
        topicId: schema.conversationTopics.topicId,
        topicName: schema.topics.name,
      })
      .from(schema.conversations)
      .innerJoin(
        schema.conversationTopics,
        eq(schema.conversations.id, schema.conversationTopics.conversationId)
      )
      .innerJoin(
        schema.topics,
        eq(schema.conversationTopics.topicId, schema.topics.id)
      )
      .where(eq(schema.conversations.userId, userId));

    const topicIds = [...new Set(userTopics.map(t => t.topicId))];
    const topicNames = [...new Set(userTopics.map(t => t.topicName))];

    // Create nodes
    const nodes: GraphNode[] = topicNames.map(name => ({
      id: name,
      label: name.replace(/-/g, " "),
      type: "topic",
    }));

    // Get edges (relations between these topics)
    const edges: GraphEdge[] = [];
    
    if (topicIds.length > 0) {
      const relations = await this.db
        .select({
          sourceId: schema.topicRelations.sourceTopicId,
          targetId: schema.topicRelations.targetTopicId,
          strength: schema.topicRelations.strength,
        })
        .from(schema.topicRelations)
        .where(
          and(
            inArray(schema.topicRelations.sourceTopicId, topicIds),
            inArray(schema.topicRelations.targetTopicId, topicIds)
          )
        );

      // Map IDs to names
      const idToName = new Map(userTopics.map(t => [t.topicId, t.topicName]));

      for (const rel of relations) {
        const sourceName = idToName.get(rel.sourceId);
        const targetName = idToName.get(rel.targetId);
        if (sourceName && targetName) {
          edges.push({
            source: sourceName,
            target: targetName,
            strength: rel.strength || 0.5,
          });
        }
      }
    }

    return { nodes, edges };
  }

  // ============ CONVERSATION HISTORY ============

  async getUserConversations(userId: string, limit: number = 10): Promise<Array<{
    id: string;
    summary: string | null;
    messageCount: number | null;
    createdAt: Date | null;
    topics: string[];
  }>> {
    const conversations = await this.db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.userId, userId))
      .orderBy(desc(schema.conversations.updatedAt))
      .limit(limit);

    // Get topics for each conversation
    const result = [];
    for (const conv of conversations) {
      const topicLinks = await this.db
        .select({ name: schema.topics.name })
        .from(schema.conversationTopics)
        .innerJoin(schema.topics, eq(schema.conversationTopics.topicId, schema.topics.id))
        .where(eq(schema.conversationTopics.conversationId, conv.id));

      result.push({
        ...conv,
        topics: topicLinks.map(t => t.name),
      });
    }

    return result;
  }

  // ============ RECENT INSIGHTS (for context without vector search) ============

  async getRecentUserInsights(userId: string, limit: number = 5): Promise<Array<{
    content: string;
    topics: string[];
  }>> {
    // Get recent insights for this user
    const results = await this.db
      .select({
        id: schema.insights.id,
        content: schema.insights.content,
      })
      .from(schema.insights)
      .where(eq(schema.insights.userId, userId))
      .orderBy(desc(schema.insights.createdAt))
      .limit(limit);

    // Get topics for each insight
    const insightsWithTopics = [];
    for (const insight of results) {
      const topicLinks = await this.db
        .select({ name: schema.topics.name })
        .from(schema.insightTopics)
        .innerJoin(schema.topics, eq(schema.insightTopics.topicId, schema.topics.id))
        .where(eq(schema.insightTopics.insightId, insight.id));

      insightsWithTopics.push({
        content: insight.content,
        topics: topicLinks.map(t => t.name),
      });
    }

    return insightsWithTopics;
  }

  async getAllUserTopics(userId: string): Promise<string[]> {
    const topics = await this.db
      .select({ name: schema.topics.name })
      .from(schema.conversations)
      .innerJoin(
        schema.conversationTopics,
        eq(schema.conversations.id, schema.conversationTopics.conversationId)
      )
      .innerJoin(
        schema.topics,
        eq(schema.conversationTopics.topicId, schema.topics.id)
      )
      .where(eq(schema.conversations.userId, userId));

    return [...new Set(topics.map(t => t.name))];
  }

  // ============ GLOBAL KNOWLEDGE (all users) ============

  async getGlobalInsights(limit: number = 30): Promise<Array<{
    content: string;
    topics: string[];
    userId: string;
  }>> {
    // Get recent insights from ALL users (excluding those from blocked conversations)
    const results = await this.db
      .select({
        id: schema.insights.id,
        content: schema.insights.content,
        userId: schema.insights.userId,
        conversationId: schema.insights.conversationId,
      })
      .from(schema.insights)
      .innerJoin(
        schema.conversations,
        eq(schema.insights.conversationId, schema.conversations.id)
      )
      .where(eq(schema.conversations.globalSharingBlocked, false))
      .orderBy(desc(schema.insights.createdAt))
      .limit(limit);

    // Get topics for each insight
    const insightsWithTopics = [];
    for (const insight of results) {
      const topicLinks = await this.db
        .select({ name: schema.topics.name })
        .from(schema.insightTopics)
        .innerJoin(schema.topics, eq(schema.insightTopics.topicId, schema.topics.id))
        .where(eq(schema.insightTopics.insightId, insight.id));

      insightsWithTopics.push({
        content: insight.content,
        topics: topicLinks.map(t => t.name),
        userId: insight.userId,
      });
    }

    return insightsWithTopics;
  }

  async getGlobalConversationSummaries(limit: number = 20): Promise<Array<{
    summary: string;
    topics: string[];
    userId: string;
  }>> {
    // Get conversation summaries from ALL users (excluding blocked ones)
    const conversations = await this.db
      .select({
        id: schema.conversations.id,
        summary: schema.conversations.summary,
        userId: schema.conversations.userId,
        globalSharingBlocked: schema.conversations.globalSharingBlocked,
      })
      .from(schema.conversations)
      .where(eq(schema.conversations.globalSharingBlocked, false))
      .orderBy(desc(schema.conversations.updatedAt))
      .limit(limit);

    const result = [];
    for (const conv of conversations) {
      if (!conv.summary) continue;
      
      const topicLinks = await this.db
        .select({ name: schema.topics.name })
        .from(schema.conversationTopics)
        .innerJoin(schema.topics, eq(schema.conversationTopics.topicId, schema.topics.id))
        .where(eq(schema.conversationTopics.conversationId, conv.id));

      result.push({
        summary: conv.summary,
        topics: topicLinks.map(t => t.name),
        userId: conv.userId,
      });
    }

    return result;
  }

  // ============ PII / GLOBAL SHARING CONTROL ============

  async setConversationGlobalSharingBlocked(conversationId: string, blocked: boolean): Promise<void> {
    await this.db
      .update(schema.conversations)
      .set({ globalSharingBlocked: blocked })
      .where(eq(schema.conversations.id, conversationId));
  }

  async isConversationGlobalSharingBlocked(conversationId: string): Promise<boolean> {
    const result = await this.db
      .select({ blocked: schema.conversations.globalSharingBlocked })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId))
      .get();
    
    return result?.blocked || false;
  }

  // ============ DELETE CONVERSATION (user graph only, keeps global) ============

  /**
   * Soft delete a conversation from user's view:
   * - Marks conversation as "deleted" (hidden from user)
   * - Removes user association from insights (so they don't show in user graph)
   * - Keeps insights linked to topics for global graph
   * - Keeps messages in DB for data integrity
   */
  async deleteConversationFromUserGraph(conversationId: string, userId: string): Promise<{
    deleted: boolean;
    insightsAnonymized: number;
  }> {
    // 1. Verify the conversation belongs to this user
    const conv = await this.db
      .select()
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.id, conversationId),
          eq(schema.conversations.userId, userId)
        )
      )
      .get();

    if (!conv) {
      return { deleted: false, insightsAnonymized: 0 };
    }

    // 2. Get insights from this conversation
    const insights = await this.db
      .select()
      .from(schema.insights)
      .where(eq(schema.insights.conversationId, conversationId));

    // 3. Anonymize insights - set userId to "anonymous" so they stay in global graph
    // but don't show in user's personal graph
    for (const insight of insights) {
      await this.db
        .update(schema.insights)
        .set({ userId: "anonymous" })
        .where(eq(schema.insights.id, insight.id));
    }

    // 4. Remove conversation-topic links (removes from user's topic graph)
    await this.db
      .delete(schema.conversationTopics)
      .where(eq(schema.conversationTopics.conversationId, conversationId));

    // 5. Mark conversation as deleted (soft delete)
    await this.db
      .update(schema.conversations)
      .set({ 
        deleted: true,
        deletedAt: new Date()
      })
      .where(eq(schema.conversations.id, conversationId));

    return { 
      deleted: true, 
      insightsAnonymized: insights.length 
    };
  }

  /**
   * Get user's conversations excluding deleted ones
   */
  async getUserActiveConversations(userId: string, limit: number = 10): Promise<Array<{
    id: string;
    summary: string | null;
    messageCount: number | null;
    createdAt: Date | null;
    topics: string[];
  }>> {
    const conversations = await this.db
      .select()
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.userId, userId),
          eq(schema.conversations.deleted, false)
        )
      )
      .orderBy(desc(schema.conversations.updatedAt))
      .limit(limit);

    const result = [];
    for (const conv of conversations) {
      const topicLinks = await this.db
        .select({ name: schema.topics.name })
        .from(schema.conversationTopics)
        .innerJoin(schema.topics, eq(schema.conversationTopics.topicId, schema.topics.id))
        .where(eq(schema.conversationTopics.conversationId, conv.id));

      result.push({
        ...conv,
        topics: topicLinks.map(t => t.name),
      });
    }

    return result;
  }
}

// Factory function
export const createGraphService = (d1: D1Database) => new GraphService(d1);
