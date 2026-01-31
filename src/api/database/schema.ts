import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core";

// ============ USERS ============
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  consentGlobal: integer("consent_global", { mode: "boolean" }).default(false),
});

// ============ TOPICS (Graph Nodes) ============
export const topics = sqliteTable("topics", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ============ TOPIC RELATIONS (Graph Edges) ============
export const topicRelations = sqliteTable("topic_relations", {
  id: text("id").primaryKey(),
  sourceTopicId: text("source_topic_id").notNull().references(() => topics.id),
  targetTopicId: text("target_topic_id").notNull().references(() => topics.id),
  strength: real("strength").default(0.5), // 0.0 to 1.0
  relationType: text("relation_type").default("related"), // related, prerequisite, subtopic
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ============ CONVERSATIONS ============
export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  summary: text("summary"),
  messageCount: integer("message_count").default(0),
  globalSharingBlocked: integer("global_sharing_blocked", { mode: "boolean" }).default(false), // PII detected and user rejected sharing
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ============ MESSAGES ============
export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id),
  role: text("role").notNull(), // "user" | "assistant"
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ============ KEY INSIGHTS ============
export const insights = sqliteTable("insights", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id),
  userId: text("user_id").notNull().references(() => users.id),
  content: text("content").notNull(),
  importanceScore: real("importance_score").default(0.5),
  embeddingId: text("embedding_id"), // Reference to vector DB
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ============ CONVERSATION-TOPIC LINKS ============
export const conversationTopics = sqliteTable("conversation_topics", {
  conversationId: text("conversation_id").notNull().references(() => conversations.id),
  topicId: text("topic_id").notNull().references(() => topics.id),
}, (table) => ({
  pk: primaryKey({ columns: [table.conversationId, table.topicId] }),
}));

// ============ INSIGHT-TOPIC LINKS ============
export const insightTopics = sqliteTable("insight_topics", {
  insightId: text("insight_id").notNull().references(() => insights.id),
  topicId: text("topic_id").notNull().references(() => topics.id),
}, (table) => ({
  pk: primaryKey({ columns: [table.insightId, table.topicId] }),
}));

// ============ GLOBAL INSIGHTS (Anonymized) ============
export const globalInsights = sqliteTable("global_insights", {
  id: text("id").primaryKey(),
  content: text("content").notNull(),
  topicIds: text("topic_ids"), // JSON array of topic IDs
  useCount: integer("use_count").default(1),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Type exports
export type User = typeof users.$inferSelect;
export type Topic = typeof topics.$inferSelect;
export type TopicRelation = typeof topicRelations.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Insight = typeof insights.$inferSelect;
