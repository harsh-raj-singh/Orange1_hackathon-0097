import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ExtractionResult, ChatMessage } from "../types";

export interface PIIDetectionResult {
  containsPII: boolean;
  piiTypes: string[];
  explanation: string;
}

export class LLMService {
  private provider: ReturnType<typeof createOpenAICompatible>;
  private model = "openai/gpt-5.2"; // Model ID for Runable AI Gateway

  constructor(baseUrl: string, apiKey: string) {
    // Use Runable AI Gateway with OpenAI-compatible provider
    this.provider = createOpenAICompatible({
      name: "runable-gateway",
      baseURL: baseUrl,
      apiKey,
    });
  }

  /**
   * Generate a chat response with optional context from the knowledge graph
   */
  async chat(messages: ChatMessage[], context?: string): Promise<string> {
    let systemPrompt = `You are NeuralChat, an intelligent AI assistant with a Graph Memory system.
You help users learn and understand topics deeply by connecting concepts.
Be concise, helpful, and insightful. When relevant, mention how topics connect to each other.`;

    if (context) {
      systemPrompt += `\n\n## Relevant Context from User's Knowledge Graph:
${context}

Use this context to provide more personalized and connected responses.`;
    }

    const { text } = await generateText({
      model: this.provider(this.model),
      system: systemPrompt,
      messages: messages.map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      temperature: 0.7,
      maxTokens: 1024,
    });

    return text || "I apologize, but I couldn't generate a response.";
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
      // Clean up response - remove markdown code blocks if present
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
   * Extract key topics, insights, and summary from a conversation
   */
  async extractInsights(conversation: string): Promise<ExtractionResult> {
    const prompt = `Analyze this conversation and extract structured information.

## Conversation:
${conversation}

## Instructions:
1. Identify main topics discussed (2-5 keywords/phrases, lowercase, hyphenated for multi-word)
2. Extract key insights or facts learned (2-4 actionable takeaways)
3. Write a brief summary (1-2 sentences)
4. Suggest related topics the user might want to explore next (2-3)

Respond in valid JSON format only:
{
  "topics": ["topic-name-1", "topic-name-2"],
  "insights": ["Key insight 1", "Key insight 2"],
  "summary": "Brief summary of the conversation",
  "relatedTopics": ["related-topic-1", "related-topic-2"]
}`;

    try {
      const { text } = await generateText({
        model: this.provider(this.model),
        prompt,
        temperature: 0.3,
        maxTokens: 512,
      });

      const content = text || "{}";
      const cleanedContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleanedContent) as ExtractionResult;
    } catch (error) {
      console.error("Failed to extract insights:", error);
      return {
        topics: [],
        insights: [],
        summary: "",
        relatedTopics: [],
      };
    }
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
