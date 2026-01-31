import { useState, useCallback } from "react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface PIIDetection {
  detected: boolean;
  types: string[];
  explanation: string;
}

interface ChatResponse {
  response: string;
  conversationId: string;
  relatedContext: Array<{
    content: string;
    topic: string;
    score: number;
  }>;
  suggestedTopics: string[];
  extractedInsights?: string[];
  piiDetection?: PIIDetection;
  globalSharingBlocked?: boolean;
}

interface UseGraphChatOptions {
  userId: string;
  apiBaseUrl?: string;
}

export function useGraphChat({ userId, apiBaseUrl = "/api" }: UseGraphChatOptions) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [suggestedTopics, setSuggestedTopics] = useState<string[]>([]);
  const [relatedContext, setRelatedContext] = useState<ChatResponse["relatedContext"]>([]);
  const [error, setError] = useState<string | null>(null);
  const [piiDetection, setPiiDetection] = useState<PIIDetection | null>(null);
  const [globalSharingBlocked, setGlobalSharingBlocked] = useState(false);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isLoading) return;

      const userMessage: Message = {
        id: `msg_${Date.now()}`,
        role: "user",
        content: content.trim(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);
      setError(null);
      setPiiDetection(null); // Clear previous PII detection

      try {
        const response = await fetch(`${apiBaseUrl}/chat/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            conversationId,
            messages: [...messages, userMessage].map((m) => ({
              role: m.role,
              content: m.content,
            })),
            saveInsights: true,
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to send message");
        }

        const data: ChatResponse = await response.json();

        const assistantMessage: Message = {
          id: `msg_${Date.now() + 1}`,
          role: "assistant",
          content: data.response,
        };

        setMessages((prev) => [...prev, assistantMessage]);
        setConversationId(data.conversationId);
        setSuggestedTopics(data.suggestedTopics);
        setRelatedContext(data.relatedContext);
        
        // Handle PII detection
        if (data.piiDetection?.detected) {
          setPiiDetection(data.piiDetection);
        }
        if (data.globalSharingBlocked) {
          setGlobalSharingBlocked(true);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        // Remove the user message on error
        setMessages((prev) => prev.slice(0, -1));
      } finally {
        setIsLoading(false);
      }
    },
    [userId, conversationId, messages, isLoading, apiBaseUrl]
  );

  // Handle PII consent decision
  const handlePIIConsent = useCallback(
    async (consent: boolean) => {
      if (!conversationId) return;

      try {
        await fetch(`${apiBaseUrl}/chat/pii-consent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, consent }),
        });

        if (!consent) {
          setGlobalSharingBlocked(true);
        }
      } catch (err) {
        console.error("Failed to update PII consent:", err);
      } finally {
        setPiiDetection(null); // Clear the modal
      }
    },
    [conversationId, apiBaseUrl]
  );

  const clearConversation = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setSuggestedTopics([]);
    setRelatedContext([]);
    setPiiDetection(null);
    setGlobalSharingBlocked(false);
  }, []);

  // Load messages from a session (for switching between chats)
  const loadMessages = useCallback((sessionMessages: Message[], convId: string | null) => {
    setMessages(sessionMessages);
    setConversationId(convId);
    setSuggestedTopics([]);
    setRelatedContext([]);
    setPiiDetection(null);
    setGlobalSharingBlocked(false);
  }, []);

  const loadConversation = useCallback(
    async (convId: string) => {
      // Placeholder for loading existing conversation
      setConversationId(convId);
    },
    []
  );

  return {
    messages,
    isLoading,
    error,
    suggestedTopics,
    relatedContext,
    conversationId,
    piiDetection,
    globalSharingBlocked,
    sendMessage,
    clearConversation,
    loadConversation,
    loadMessages,
    handlePIIConsent,
  };
}

// Hook for fetching knowledge graph visualization data
export function useKnowledgeGraph(userId: string, apiBaseUrl = "/api") {
  const [nodes, setNodes] = useState<Array<{ id: string; label: string }>>([]);
  const [edges, setEdges] = useState<Array<{ source: string; target: string; strength: number }>>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchGraph = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/graph/user/${userId}/map`);
      const data = await response.json();
      setNodes(data.nodes || []);
      setEdges(data.edges || []);
    } catch (error) {
      console.error("Failed to fetch knowledge graph:", error);
    } finally {
      setIsLoading(false);
    }
  }, [userId, apiBaseUrl]);

  return { nodes, edges, isLoading, fetchGraph };
}

// Hook for semantic search
export function useKnowledgeSearch(userId: string, apiBaseUrl = "/api") {
  const [results, setResults] = useState<Array<{
    id: string;
    content: string;
    topics: string[];
    score: number;
  }>>([]);
  const [isLoading, setIsLoading] = useState(false);

  const search = useCallback(
    async (query: string) => {
      if (!query.trim()) return;

      setIsLoading(true);
      try {
        const response = await fetch(`${apiBaseUrl}/knowledge/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, userId, limit: 10 }),
        });
        const data = await response.json();
        setResults(data.results || []);
      } catch (error) {
        console.error("Search failed:", error);
      } finally {
        setIsLoading(false);
      }
    },
    [userId, apiBaseUrl]
  );

  return { results, isLoading, search };
}
