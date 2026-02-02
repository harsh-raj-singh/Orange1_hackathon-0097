import { useState, useCallback, useEffect, useRef } from "react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

interface PIIDetection {
  detected: boolean;
  types: string[];
  explanation: string;
}

interface ProcessingStatus {
  processed: boolean;
  isUseful: boolean | null;
  reason: string | null;
  topicsExtracted: string[];
  insightsCount: number;
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
  enableStreaming?: boolean;
}

export function useGraphChat({ userId, apiBaseUrl = "/api", enableStreaming = true }: UseGraphChatOptions) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [suggestedTopics, setSuggestedTopics] = useState<string[]>([]);
  const [relatedContext, setRelatedContext] = useState<ChatResponse["relatedContext"]>([]);
  const [error, setError] = useState<string | null>(null);
  const [piiDetection, setPiiDetection] = useState<PIIDetection | null>(null);
  const [globalSharingBlocked, setGlobalSharingBlocked] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const processorTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastMessageTimeRef = useRef<number>(Date.now());

  // Poll for processing status when conversation exists and not yet processed
  const checkProcessingStatus = useCallback(async () => {
    if (!conversationId) return;
    
    try {
      const response = await fetch(`${apiBaseUrl}/chat/status/${conversationId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.processed) {
          setProcessingStatus({
            processed: true,
            isUseful: data.isUseful,
            reason: data.processingLog?.reason || data.usefulnessReason,
            topicsExtracted: data.processingLog?.topicsExtracted || [],
            insightsCount: data.processingLog?.insightsCount || 0
          });
          // Stop polling once processed
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        }
      }
    } catch (err) {
      console.error("Failed to check processing status:", err);
    }
  }, [conversationId, apiBaseUrl]);

  // Trigger the background processor
  const triggerProcessor = useCallback(async () => {
    try {
      console.log("[Processor] Triggering background processor...");
      const response = await fetch(`${apiBaseUrl}/processor/run`, { method: "POST" });
      if (response.ok) {
        const data = await response.json();
        console.log("[Processor] Result:", data);
        // Check our conversation status after processing
        setTimeout(checkProcessingStatus, 2000);
      }
    } catch (err) {
      console.error("[Processor] Failed to trigger:", err);
    }
  }, [apiBaseUrl, checkProcessingStatus]);

  // Reset processor timer (called when user sends a message)
  const resetProcessorTimer = useCallback(() => {
    lastMessageTimeRef.current = Date.now();
    
    // Clear existing timer
    if (processorTimerRef.current) {
      clearTimeout(processorTimerRef.current);
    }
    
    // Set new timer for 2 minutes
    processorTimerRef.current = setTimeout(() => {
      console.log("[Processor] 2 minutes of inactivity - triggering processor");
      triggerProcessor();
    }, 2 * 60 * 1000); // 2 minutes
    
    console.log("[Processor] Timer reset - will trigger in 2 minutes");
  }, [triggerProcessor]);

  // Start polling when conversation is active
  useEffect(() => {
    if (conversationId && messages.length > 0 && !processingStatus?.processed) {
      // Start polling every 30 seconds
      pollingRef.current = setInterval(checkProcessingStatus, 30000);
      // Also check immediately after 5 seconds of inactivity
      const immediateCheck = setTimeout(checkProcessingStatus, 5000);
      
      return () => {
        if (pollingRef.current) clearInterval(pollingRef.current);
        clearTimeout(immediateCheck);
      };
    }
  }, [conversationId, messages.length, processingStatus?.processed, checkProcessingStatus]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
      if (processorTimerRef.current) clearTimeout(processorTimerRef.current);
    };
  }, []);

  // Streaming send message
  const sendMessageStreaming = useCallback(
    async (content: string) => {
      if (!content.trim() || isLoading || isStreaming) return;

      // Reset the processor timer when user sends a message
      resetProcessorTimer();

      const userMessage: Message = {
        id: `msg_${Date.now()}`,
        role: "user",
        content: content.trim(),
      };

      // Create placeholder for streaming message
      const assistantMessageId = `msg_${Date.now() + 1}`;
      const assistantMessage: Message = {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        isStreaming: true,
      };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setIsStreaming(true);
      setError(null);
      setPiiDetection(null);
      setProcessingStatus(null);

      // Cancel any existing stream
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      try {
        const response = await fetch(`${apiBaseUrl}/chat/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            conversationId,
            messages: [...messages, userMessage].map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error("Failed to start stream");
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let fullContent = "";
        let newConvId: string | null = null;
        let buffer = ""; // Buffer for incomplete chunks

        const processLine = (line: string) => {
          if (!line.startsWith("data: ")) return;
          
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) return;
          
          try {
            const data = JSON.parse(jsonStr);
            
            if (data.error) {
              throw new Error(data.error);
            }
            
            if (data.conversationId) {
              newConvId = data.conversationId;
            }
            
            if (data.text) {
              fullContent += data.text;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMessageId
                    ? { ...m, content: fullContent }
                    : m
                )
              );
            }
            
            if (data.done) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMessageId
                    ? { ...m, isStreaming: false }
                    : m
                )
              );
            }
          } catch {
            // JSON parse failed - likely incomplete, will be handled in next chunk
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Append new chunk to buffer
          buffer += decoder.decode(value, { stream: true });
          
          // Process complete messages (ending with \n\n)
          let endIndex;
          while ((endIndex = buffer.indexOf("\n\n")) !== -1) {
            const message = buffer.slice(0, endIndex);
            buffer = buffer.slice(endIndex + 2);
            
            // Process each line in the message
            const lines = message.split("\n");
            for (const line of lines) {
              processLine(line);
            }
          }
        }

        // Process any remaining buffer after stream ends
        if (buffer.trim()) {
          const lines = buffer.split("\n");
          for (const line of lines) {
            processLine(line);
          }
        }
        
        // Mark as done if not already
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId
              ? { ...m, isStreaming: false }
              : m
          )
        );

        if (newConvId) {
          setConversationId(newConvId);
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          // Stream was cancelled, that's fine
          return;
        }
        setError(err instanceof Error ? err.message : "Unknown error");
        // Remove both messages on error
        setMessages((prev) => prev.slice(0, -2));
      } finally {
        setIsStreaming(false);
      }
    },
    [userId, conversationId, messages, isLoading, isStreaming, apiBaseUrl, resetProcessorTimer]
  );

  // Non-streaming send message (fallback)
  const sendMessageNonStreaming = useCallback(
    async (content: string) => {
      if (!content.trim() || isLoading) return;

      // Reset the processor timer when user sends a message
      resetProcessorTimer();

      const userMessage: Message = {
        id: `msg_${Date.now()}`,
        role: "user",
        content: content.trim(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);
      setError(null);
      setPiiDetection(null);
      setProcessingStatus(null);

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
        
        if (data.piiDetection?.detected) {
          setPiiDetection(data.piiDetection);
        }
        if (data.globalSharingBlocked) {
          setGlobalSharingBlocked(true);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setMessages((prev) => prev.slice(0, -1));
      } finally {
        setIsLoading(false);
      }
    },
    [userId, conversationId, messages, isLoading, apiBaseUrl, resetProcessorTimer]
  );

  // Main send message - uses streaming if enabled
  const sendMessage = useCallback(
    async (content: string) => {
      if (enableStreaming) {
        await sendMessageStreaming(content);
      } else {
        await sendMessageNonStreaming(content);
      }
    },
    [enableStreaming, sendMessageStreaming, sendMessageNonStreaming]
  );

  // Stop streaming
  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
    }
  }, []);

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
    setProcessingStatus(null);
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  // Delete conversation from user graph (keeps in global)
  const deleteConversation = useCallback(
    async (convId?: string) => {
      const targetConvId = convId || conversationId;
      if (!targetConvId) return false;

      try {
        const response = await fetch(`${apiBaseUrl}/chat/${targetConvId}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        });

        if (!response.ok) {
          const error = await response.json();
          console.error("Delete failed:", error);
          return false;
        }

        // If we deleted the current conversation, clear it
        if (targetConvId === conversationId) {
          clearConversation();
        }

        return true;
      } catch (err) {
        console.error("Failed to delete conversation:", err);
        return false;
      }
    },
    [conversationId, userId, apiBaseUrl, clearConversation]
  );

  // Load messages from a session (for switching between chats)
  const loadMessages = useCallback((sessionMessages: Message[], convId: string | null) => {
    setMessages(sessionMessages);
    setConversationId(convId);
    setSuggestedTopics([]);
    setRelatedContext([]);
    setPiiDetection(null);
    setGlobalSharingBlocked(false);
    setProcessingStatus(null);
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
    isStreaming,
    error,
    suggestedTopics,
    relatedContext,
    conversationId,
    piiDetection,
    globalSharingBlocked,
    processingStatus,
    sendMessage,
    stopStreaming,
    clearConversation,
    deleteConversation,
    loadConversation,
    loadMessages,
    handlePIIConsent,
    checkProcessingStatus,
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
