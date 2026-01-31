// Types for the Knowledge Graph Chat System

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  userId: string;
  conversationId?: string; // Existing or new
  messages: ChatMessage[];
  saveInsights?: boolean;
  globalSharingConsent?: boolean; // User's consent for global sharing when PII detected
}

export interface PIIDetection {
  detected: boolean;
  types: string[];
  explanation: string;
}

export interface ChatResponse {
  response: string;
  conversationId: string;
  relatedContext: RelatedContext[];
  suggestedTopics: string[];
  extractedInsights?: string[];
  piiDetection?: PIIDetection; // PII detection result
  globalSharingBlocked?: boolean; // Whether this message is blocked from global sharing
}

export interface RelatedContext {
  content: string;
  topic: string;
  score: number;
  source: "graph" | "vector";
}

export interface ExtractionResult {
  topics: string[];
  insights: string[];
  summary: string;
  relatedTopics: string[];
}

export interface GraphNode {
  id: string;
  label: string;
  type: "topic" | "insight" | "conversation";
  size?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  strength: number;
  type?: string;
}

export interface KnowledgeMap {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface VectorSearchResult {
  id: string;
  content: string;
  topics: string[];
  score: number;
}

// Environment bindings for Cloudflare Workers
export interface Env {
  DB: D1Database;
  AI_GATEWAY_BASE_URL: string;
  AI_GATEWAY_API_KEY: string;
  UPSTASH_VECTOR_REST_URL: string;
  UPSTASH_VECTOR_REST_TOKEN: string;
}
