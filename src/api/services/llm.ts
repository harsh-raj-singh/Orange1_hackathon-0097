import { generateText, streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ExtractionResult, ChatMessage } from "../types";

export interface PIIDetectionResult {
  containsPII: boolean;
  piiTypes: string[];
  explanation: string;
}

export interface ConversationAnalysis {
  isUseful: boolean;
  reason: string;
  topics: string[]; // 0-6 topics based on content richness
  insights: string[];
  summary: string;
  relatedTopics: string[];
  isComplete: boolean; // Whether the conversation seems finished
}

export interface QueryClassification {
  isTrivial: boolean;
  suggestedResponseLength: "short" | "medium" | "long";
}

export class LLMService {
  private provider: ReturnType<typeof createOpenAICompatible>;
  private model = "openai/gpt-5.2"; // Model ID for Runable AI Gateway

  constructor(baseUrl: string, apiKey: string) {
    this.provider = createOpenAICompatible({
      name: "runable-gateway",
      baseURL: baseUrl,
      apiKey,
    });
  }

  /**
   * Classify if a query is trivial (greeting, simple question, etc.)
   */
  async classifyQuery(query: string): Promise<QueryClassification> {
    const prompt = `Classify this user query:

Query: "${query}"

Is this a trivial/simple query that doesn't need a detailed response?
Trivial queries include:
- Greetings (hi, hello, hey, etc.)
- Simple acknowledgments (ok, thanks, sure, etc.)
- Generic small talk (how are you, what's up, etc.)
- Simple factual questions with one-word answers (what's 2+2, what day is it, etc.)

Respond in JSON only:
{
  "isTrivial": true/false,
  "suggestedResponseLength": "short" | "medium" | "long"
}

- short: 1-2 sentences max
- medium: 2-4 sentences
- long: detailed response`;

    try {
      const { text } = await generateText({
        model: this.provider(this.model),
        prompt,
        temperature: 0.1,
        maxTokens: 100,
      });

      const content = text || "{}";
      const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const result = JSON.parse(cleaned);
      return {
        isTrivial: result.isTrivial || false,
        suggestedResponseLength: result.suggestedResponseLength || "medium",
      };
    } catch {
      return { isTrivial: false, suggestedResponseLength: "medium" };
    }
  }

  /**
   * Generate a chat response with optional context from the knowledge graph
   * Now supports response length adjustment based on query type
   */
  async chat(
    messages: ChatMessage[], 
    context?: string,
    responseLength: "short" | "medium" | "long" = "medium"
  ): Promise<string> {
    const lengthInstructions = {
      short: "Keep your response very brief - 1-2 sentences max. Be friendly but concise.",
      medium: "Provide a helpful response in 2-4 sentences.",
      long: "Provide a detailed, comprehensive response.",
    };

    let systemPrompt = `You are Orange1, an intelligent AI assistant with a Graph Memory system.
You help users learn and understand topics deeply by connecting concepts.
${lengthInstructions[responseLength]}`;

    if (context) {
      systemPrompt += `\n\n## Relevant Context from User's Knowledge Graph:
${context}

Use this context to provide more personalized and connected responses.`;
    }

    const maxTokens = responseLength === "short" ? 100 : responseLength === "medium" ? 512 : 1024;

    const { text } = await generateText({
      model: this.provider(this.model),
      system: systemPrompt,
      messages: messages.map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      temperature: 0.7,
      maxTokens,
    });

    return text || "I apologize, but I couldn't generate a response.";
  }

  /**
   * Generate a streaming chat response
   * Returns a ReadableStream for SSE
   */
  chatStream(
    messages: ChatMessage[], 
    context?: string,
    responseLength: "short" | "medium" | "long" = "medium"
  ) {
    const lengthInstructions = {
      short: "Keep your response very brief - 1-2 sentences max. Be friendly but concise.",
      medium: "Provide a helpful response in 2-4 sentences.",
      long: "Provide a detailed, comprehensive response.",
    };

    let systemPrompt = `You are Orange1, an intelligent AI assistant with a Graph Memory system.
You help users learn and understand topics deeply by connecting concepts.
${lengthInstructions[responseLength]}`;

    if (context) {
      systemPrompt += `\n\n## Relevant Context from User's Knowledge Graph:
${context}

Use this context to provide more personalized and connected responses.`;
    }

    const maxTokens = responseLength === "short" ? 100 : responseLength === "medium" ? 512 : 1024;

    return streamText({
      model: this.provider(this.model),
      system: systemPrompt,
      messages: messages.map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      temperature: 0.7,
      maxTokens,
    });
  }

  /**
   * Detect PII (Personally Identifiable Information) in text
   */
  async detectPII(userQuery: string, assistantResponse: string): Promise<PIIDetectionResult> {
    const prompt = `Analyze the following conversation exchange for PII (Personally Identifiable Information).

## User Query:
${userQuery}

## Assistant Response:
${assistantResponse}

## PII Types to Detect:
- Names (full names, first names that identify specific people)
- Email addresses
- Phone numbers
- Physical addresses (street, city, zip)
- Social Security Numbers or government IDs
- Medical information (specific conditions, prescriptions, doctor names, hospital names)
- Financial information (account numbers, credit card numbers, salaries, specific amounts tied to a person)
- Dates of birth
- Usernames or account identifiers
- Any other personally identifying information

## Instructions:
Determine if the conversation contains ANY PII. Be thorough but reasonable - generic medical or financial discussions without specific personal details are NOT PII.

Respond in valid JSON format only:
{
  "containsPII": true/false,
  "piiTypes": ["list", "of", "detected", "pii", "types"],
  "explanation": "Brief explanation of what PII was found or why none was detected"
}`;

    try {
      const { text } = await generateText({
        model: this.provider(this.model),
        prompt,
        temperature: 0.1,
        maxTokens: 256,
      });

      const content = text || "{}";
      const cleanedContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const result = JSON.parse(cleanedContent);
      
      return {
        containsPII: result.containsPII || false,
        piiTypes: result.piiTypes || [],
        explanation: result.explanation || "",
      };
    } catch (error) {
      console.error("Failed to detect PII:", error);
      return {
        containsPII: false,
        piiTypes: [],
        explanation: "PII detection unavailable",
      };
    }
  }

  /**
   * Analyze a full conversation to determine if it's worth storing in the graph
   * This is the main method for the background job to process stale conversations
   */
  async analyzeConversation(messages: ChatMessage[]): Promise<ConversationAnalysis> {
    const conversationText = messages
      .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");

    const prompt = `Analyze this conversation and determine if it contains meaningful information worth remembering in a knowledge graph.

## Conversation:
${conversationText}

## Instructions:
1. Determine if this conversation is USEFUL (contains facts, insights, decisions, or meaningful information that could be valuable to remember later).

NOT useful examples:
- Just greetings/goodbyes
- Simple small talk
- Generic questions like "what's the weather" with no follow-up
- Test messages
- Random/nonsensical messages

USEFUL examples:
- Learning about a topic (even basic facts)
- Problem-solving or troubleshooting
- Discussions about projects, plans, or decisions
- Technical explanations
- Personal preferences or requirements shared

2. If useful, extract 1-6 topic labels (only as many as truly relevant - don't force 6 if there's only 1 topic).
   Format: lowercase, hyphenated for multi-word (e.g., "machine-learning", "aws-troubleshooting")

3. Extract key insights - concrete facts or takeaways (0-4 based on content).

4. Determine if the conversation seems COMPLETE (natural ending, topic concluded) or INCOMPLETE (mid-discussion, waiting for more).

Respond in JSON only:
{
  "isUseful": true/false,
  "reason": "Brief explanation of why this is/isn't worth storing",
  "topics": ["topic-1", "topic-2"],
  "insights": ["Insight 1", "Insight 2"],
  "summary": "1-2 sentence summary of the conversation",
  "relatedTopics": ["related-1", "related-2"],
  "isComplete": true/false
}`;

    try {
      const { text } = await generateText({
        model: this.provider(this.model),
        prompt,
        temperature: 0.2,
        maxTokens: 600,
      });

      const content = text || "{}";
      const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const result = JSON.parse(cleaned);

      // Enforce max 6 topics
      const topics = (result.topics || []).slice(0, 6);

      return {
        isUseful: result.isUseful || false,
        reason: result.reason || "",
        topics,
        insights: result.insights || [],
        summary: result.summary || "",
        relatedTopics: result.relatedTopics || [],
        isComplete: result.isComplete ?? true,
      };
    } catch (error) {
      console.error("Failed to analyze conversation:", error);
      return {
        isUseful: false,
        reason: "Analysis failed",
        topics: [],
        insights: [],
        summary: "",
        relatedTopics: [],
        isComplete: true,
      };
    }
  }

  /**
   * Extract key topics, insights, and summary from a conversation
   * Legacy method - now wraps analyzeConversation for backward compatibility
   */
  async extractInsights(conversation: string): Promise<ExtractionResult> {
    const messages: ChatMessage[] = conversation.split('\n')
      .filter(line => line.startsWith('User:') || line.startsWith('Assistant:'))
      .map((line, i) => ({
        id: String(i),
        role: line.startsWith('User:') ? 'user' as const : 'assistant' as const,
        content: line.replace(/^(User|Assistant):\s*/, ''),
      }));

    if (messages.length === 0) {
      // Fallback for raw text
      messages.push({ id: '0', role: 'user', content: conversation });
    }

    const analysis = await this.analyzeConversation(messages);
    
    return {
      topics: analysis.topics,
      insights: analysis.insights,
      summary: analysis.summary,
      relatedTopics: analysis.relatedTopics,
    };
  }

  /**
   * Generate a topic summary
   */
  async generateTopicSummary(topic: string): Promise<string> {
    const { text } = await generateText({
      model: this.provider(this.model),
      prompt: `In one sentence, describe what "${topic}" means in a learning context.`,
      temperature: 0.3,
      maxTokens: 100,
    });

    return text || topic;
  }
}

// Factory function for Cloudflare Workers
export const createLLMService = (baseUrl: string, apiKey: string) => new LLMService(baseUrl, apiKey);
