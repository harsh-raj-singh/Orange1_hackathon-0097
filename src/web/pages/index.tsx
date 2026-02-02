import { useState, useEffect, useRef, useCallback } from "react";
import { useGraphChat } from "@/lib/useGraphChat";

// Types
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  source?: string;
}

interface ChatSession {
  id: string;
  conversationId: string | null; // The actual API conversation ID (conv_*)
  title: string;
  preview: string;
  timestamp: Date;
  messages: Message[];
}

// Generate or retrieve userId from localStorage
const getUserId = (): string => {
  const stored = localStorage.getItem("neuralchat_user_id");
  if (stored) return stored;
  const newId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  localStorage.setItem("neuralchat_user_id", newId);
  return newId;
};

// Save conversation history to localStorage
const saveConversations = (conversations: ChatSession[]) => {
  localStorage.setItem("neuralchat_history", JSON.stringify(conversations));
};

// Load conversation history from localStorage
const loadConversations = (): ChatSession[] => {
  const stored = localStorage.getItem("neuralchat_history");
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    return parsed.map((c: ChatSession) => ({
      ...c,
      timestamp: new Date(c.timestamp),
      conversationId: c.conversationId || null, // Handle old sessions without conversationId
    }));
  } catch {
    return [];
  }
};

// Icons
const PlusIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const MenuIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);

const SendIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

const GraphIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="6" r="3" />
    <circle cx="18" cy="18" r="3" />
    <circle cx="18" cy="6" r="3" />
    <line x1="8.5" y1="7.5" x2="15.5" y2="16.5" />
    <line x1="15.5" y1="7.5" x2="8.5" y2="8.5" />
  </svg>
);

const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const BrainIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.54" />
    <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.54" />
  </svg>
);

const ShieldIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

// PII Detection Modal Component
const PIIModal = ({ 
  piiDetection, 
  onApprove, 
  onReject 
}: { 
  piiDetection: { detected: boolean; types: string[]; explanation: string }; 
  onApprove: () => void; 
  onReject: () => void;
}) => (
  <div className="mx-4 mb-4 p-4 bg-gradient-to-br from-amber-500/10 to-orange-500/5 border border-amber-500/20 rounded-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center flex-shrink-0">
        <ShieldIcon />
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-semibold text-amber-400 mb-1">Personal Information Detected</h4>
        <p className="text-xs text-gray-400 mb-2">{piiDetection.explanation}</p>
        {piiDetection.types.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {piiDetection.types.map((type, i) => (
              <span key={i} className="px-2 py-0.5 text-[10px] font-medium bg-amber-500/10 border border-amber-500/20 rounded-full text-amber-400">
                {type}
              </span>
            ))}
          </div>
        )}
        <p className="text-xs text-gray-500 mb-3">
          Share this conversation to the global knowledge base? Others will be able to learn from it.
        </p>
        <div className="flex gap-2">
          <button
            onClick={onReject}
            className="px-3 py-1.5 text-xs font-medium text-gray-400 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors"
          >
            Keep Private
          </button>
          <button
            onClick={onApprove}
            className="px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-emerald-500 to-cyan-500 rounded-lg hover:opacity-90 transition-opacity"
          >
            Share Anyway
          </button>
        </div>
      </div>
    </div>
  </div>
);

// Processing Status Badge Component (shows when conversation is analyzed)
const ProcessingStatusBadge = ({ 
  status 
}: { 
  status: { 
    processed: boolean; 
    isUseful: boolean | null; 
    reason: string | null;
    topicsExtracted: string[];
    insightsCount: number;
  } 
}) => {
  if (!status.processed) return null;
  
  const isUseful = status.isUseful;
  
  return (
    <div className={`mx-4 mb-4 p-3 rounded-xl animate-in fade-in slide-in-from-bottom-2 duration-500 ${
      isUseful 
        ? "bg-gradient-to-br from-emerald-500/10 to-cyan-500/5 border border-emerald-500/20" 
        : "bg-gradient-to-br from-gray-500/10 to-gray-400/5 border border-gray-500/20"
    }`}>
      <div className="flex items-start gap-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
          isUseful ? "bg-emerald-500/20" : "bg-gray-500/20"
        }`}>
          {isUseful ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-400">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-400">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className={`text-xs font-semibold mb-1 ${isUseful ? "text-emerald-400" : "text-gray-400"}`}>
            {isUseful ? "📚 Added to Knowledge Graph" : "💬 Conversation Not Stored"}
          </h4>
          <p className="text-xs text-gray-500 mb-2">{status.reason}</p>
          {isUseful && status.topicsExtracted.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {status.topicsExtracted.map((topic, i) => (
                <span 
                  key={i} 
                  className="px-2 py-0.5 text-[10px] font-medium bg-emerald-500/10 border border-emerald-500/20 rounded-full text-emerald-400"
                >
                  {topic}
                </span>
              ))}
              {status.insightsCount > 0 && (
                <span className="px-2 py-0.5 text-[10px] font-medium bg-cyan-500/10 border border-cyan-500/20 rounded-full text-cyan-400">
                  +{status.insightsCount} insight{status.insightsCount > 1 ? "s" : ""}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Typing Indicator Component
const TypingIndicator = () => (
  <div className="flex items-center gap-1.5 px-4 py-3">
    <div className="typing-dot w-2 h-2 rounded-full bg-emerald-400" />
    <div className="typing-dot w-2 h-2 rounded-full bg-emerald-400" />
    <div className="typing-dot w-2 h-2 rounded-full bg-emerald-400" />
  </div>
);

// Message Component
const ChatMessage = ({ message, isLatest }: { message: Message; isLatest: boolean }) => {
  const isUser = message.role === "user";
  
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} ${isLatest ? "message-appear" : ""}`}>
      <div className={`max-w-[85%] md:max-w-[70%] ${isUser ? "order-2" : "order-1"}`}>
        {!isUser && (
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-400 flex items-center justify-center">
              <BrainIcon />
            </div>
            <span className="text-xs font-medium text-emerald-400">NeuralChat</span>
            {message.source && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-medium text-emerald-400">
                <GraphIcon />
                Graph Memory
              </span>
            )}
          </div>
        )}
        <div
          className={`px-4 py-3 rounded-2xl ${
            isUser
              ? "bg-[#1a1a24] text-white rounded-br-md"
              : "bg-gradient-to-br from-emerald-500/10 to-cyan-500/5 border border-emerald-500/10 text-gray-100 rounded-bl-md"
          }`}
        >
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    </div>
  );
};

// Sidebar Component
const Sidebar = ({
  isOpen,
  onClose,
  sessions,
  currentSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
}: {
  isOpen: boolean;
  onClose: () => void;
  sessions: ChatSession[];
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onDeleteSession: (id: string) => void;
}) => {
  const formatTimestamp = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed md:relative top-0 left-0 h-full w-72 bg-[#08080c] border-r border-white/5 flex flex-col z-50 transition-transform duration-300 ease-out ${
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        {/* Header */}
        <div className="p-4 border-b border-white/5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <BrainIcon />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-white tracking-tight">NeuralChat</h1>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-glow" />
                  <span className="text-[10px] font-medium text-emerald-400/80">Graph Memory Active</span>
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="md:hidden p-2 rounded-lg hover:bg-white/5 text-gray-400 transition-colors"
            >
              <CloseIcon />
            </button>
          </div>

          {/* New Chat Button */}
          <button
            onClick={onNewChat}
            className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-white font-medium text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity shadow-lg shadow-emerald-500/20"
          >
            <PlusIcon />
            New Chat
          </button>
        </div>

        {/* Chat Sessions */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider px-2 mb-2">
            Recent Conversations
          </p>
          <div className="space-y-1">
            {sessions.length === 0 ? (
              <div className="px-3 py-8 text-center">
                <p className="text-sm text-gray-500">No conversations yet</p>
                <p className="text-xs text-gray-600 mt-1">Start a new chat to begin</p>
              </div>
            ) : (
              sessions.map((session) => (
                <div
                  key={session.id}
                  className={`relative w-full text-left p-3 rounded-xl transition-all duration-200 group ${
                    currentSessionId === session.id
                      ? "bg-gradient-to-r from-emerald-500/10 to-cyan-500/5 border border-emerald-500/20"
                      : "hover:bg-white/5 border border-transparent"
                  }`}
                >
                  <button
                    onClick={() => onSelectSession(session.id)}
                    className="w-full text-left"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className={`text-sm font-medium truncate pr-6 ${
                        currentSessionId === session.id ? "text-emerald-400" : "text-gray-200 group-hover:text-white"
                      }`}>
                        {session.title}
                      </h3>
                      <span className="text-[10px] text-gray-500 whitespace-nowrap">
                        {formatTimestamp(session.timestamp)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2 pr-6">{session.preview}</p>
                  </button>
                  {/* Delete button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm("Delete this conversation? It will be removed from your graph but kept in global knowledge.")) {
                        onDeleteSession(session.id);
                      }
                    }}
                    className="absolute right-2 top-2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-gray-500 hover:text-red-400 transition-all"
                    title="Delete conversation"
                  >
                    <TrashIcon />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/5 space-y-3">
          <a
            href="/graph"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500/10 to-cyan-500/5 border border-emerald-500/20 hover:border-emerald-500/40 transition-all group"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 flex items-center justify-center text-emerald-400 group-hover:scale-110 transition-transform">
              <GraphIcon />
            </div>
            <div>
              <p className="text-sm font-medium text-emerald-400">Explore Graph</p>
              <p className="text-[10px] text-gray-500">Visualize knowledge connections</p>
            </div>
          </a>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 pulse-glow" />
            <span>Powered by Graph Memory</span>
          </div>
        </div>
      </aside>
    </>
  );
};

// Suggested Topics Component
const SuggestedTopics = ({
  topics,
  onSelect,
}: {
  topics: string[];
  onSelect: (topic: string) => void;
}) => {
  if (topics.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {topics.map((topic, index) => (
        <button
          key={index}
          onClick={() => onSelect(`Tell me more about ${topic}`)}
          className="px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
        >
          {topic}
        </button>
      ))}
    </div>
  );
};

// Main Index Component
const Index = () => {
  const [userId] = useState(getUserId);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    messages,
    isLoading,
    suggestedTopics,
    relatedContext,
    sendMessage,
    clearConversation,
    deleteConversation,
    loadMessages,
    piiDetection,
    globalSharingBlocked,
    handlePIIConsent,
    processingStatus,
    isStreaming,
    conversationId, // The actual API conversation ID
  } = useGraphChat({ userId });

  // Load conversations on mount
  useEffect(() => {
    const loaded = loadConversations();
    setSessions(loaded);
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [inputValue]);

  // Save current conversation to history
  const saveCurrentConversation = useCallback(() => {
    if (messages.length === 0) return;

    const existingIndex = sessions.findIndex((s) => s.id === currentSessionId);
    const title = messages[0]?.content.slice(0, 40) + (messages[0]?.content.length > 40 ? "..." : "");
    const preview = messages[messages.length - 1]?.content.slice(0, 80) + "...";
    const sessionId = currentSessionId || `session_${Date.now()}`;

    const newSession: ChatSession = {
      id: sessionId,
      conversationId: conversationId, // Store the actual API conversation ID
      title,
      preview,
      timestamp: new Date(),
      messages: messages.map((m) => ({ ...m, source: relatedContext.length > 0 ? "graph" : undefined })),
    };

    let updatedSessions: ChatSession[];
    if (existingIndex >= 0) {
      updatedSessions = [...sessions];
      updatedSessions[existingIndex] = newSession;
    } else {
      updatedSessions = [newSession, ...sessions];
      setCurrentSessionId(sessionId);
    }

    setSessions(updatedSessions);
    saveConversations(updatedSessions);
  }, [messages, sessions, currentSessionId, relatedContext, conversationId]);

  // Save conversation when messages change
  useEffect(() => {
    if (messages.length > 0) {
      saveCurrentConversation();
    }
  }, [messages]);

  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return;
    const message = inputValue.trim();
    setInputValue("");
    await sendMessage(message);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewChat = () => {
    clearConversation();
    setCurrentSessionId(null);
    setInputValue("");
    setSidebarOpen(false);
  };

  const handleSelectSession = (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (session) {
      // Load the messages from the session with the actual API conversationId
      loadMessages(session.messages, session.conversationId || null);
      setCurrentSessionId(sessionId);
      setSidebarOpen(false);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    // Delete from backend using the actual conversationId
    const deleted = await deleteConversation(session?.conversationId || sessionId);
    
    if (deleted) {
      // Remove from local state
      const updatedSessions = sessions.filter((s) => s.id !== sessionId);
      setSessions(updatedSessions);
      saveConversations(updatedSessions);
      
      // If we deleted the current session, clear it
      if (sessionId === currentSessionId) {
        setCurrentSessionId(null);
      }
    }
  };

  const handleTopicClick = (topic: string) => {
    setInputValue(topic);
    textareaRef.current?.focus();
  };

  return (
    <div className="h-screen flex bg-[#0a0a0f] overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        onDeleteSession={handleDeleteSession}
      />

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-14 flex items-center justify-between px-4 border-b border-white/5 bg-[#0a0a0f]/80 backdrop-blur-sm">
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden p-2 -ml-2 rounded-lg hover:bg-white/5 text-gray-400 transition-colors"
          >
            <MenuIcon />
          </button>
          
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-gray-300 hidden md:block">
              {currentSessionId ? "Continuing Conversation" : "New Conversation"}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {relatedContext.length > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-xs font-medium text-emerald-400">
                <GraphIcon />
                {relatedContext.length} context{relatedContext.length > 1 ? "s" : ""} found
              </span>
            )}
          </div>
        </header>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[50vh] text-center px-4">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-400 flex items-center justify-center mb-6 shadow-2xl shadow-emerald-500/30">
                  <BrainIcon />
                </div>
                <h2 className="text-2xl font-semibold text-white mb-2">
                  Welcome to <span className="gradient-text">NeuralChat</span>
                </h2>
                <p className="text-gray-400 max-w-md mb-8">
                  An AI assistant with graph memory that remembers your conversations and connects related insights.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
                  {[
                    "What can you help me with?",
                    "How does graph memory work?",
                    "Explain quantum computing",
                    "Help me plan a project",
                  ].map((prompt, i) => (
                    <button
                      key={i}
                      onClick={() => handleTopicClick(prompt)}
                      className="px-4 py-3 rounded-xl bg-[#1a1a24] border border-white/5 text-sm text-gray-300 hover:bg-[#22222e] hover:border-emerald-500/20 transition-all text-left"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message, index) => (
                <ChatMessage
                  key={message.id}
                  message={{
                    ...message,
                    source: message.role === "assistant" && relatedContext.length > 0 ? "graph" : undefined,
                  }}
                  isLatest={index === messages.length - 1}
                />
              ))
            )}
            
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-gradient-to-br from-emerald-500/10 to-cyan-500/5 border border-emerald-500/10 rounded-2xl rounded-bl-md">
                  <TypingIndicator />
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* PII Detection Modal */}
        {piiDetection && (
          <PIIModal
            piiDetection={piiDetection}
            onApprove={() => handlePIIConsent(true)}
            onReject={() => handlePIIConsent(false)}
          />
        )}

        {/* Processing Status Badge (shows when conversation is analyzed) */}
        {processingStatus && !piiDetection && (
          <ProcessingStatusBadge status={processingStatus} />
        )}

        {/* Global Sharing Blocked Indicator */}
        {globalSharingBlocked && !piiDetection && !processingStatus && (
          <div className="mx-4 mb-2 px-3 py-2 bg-gray-500/10 border border-gray-500/20 rounded-lg flex items-center gap-2">
            <ShieldIcon />
            <span className="text-xs text-gray-400">This conversation is private and won't be shared to global memory</span>
          </div>
        )}

        {/* Input Area */}
        <div className="border-t border-white/5 bg-[#0a0a0f]/80 backdrop-blur-sm p-4">
          <div className="max-w-3xl mx-auto">
            {/* Suggested Topics */}
            <SuggestedTopics topics={suggestedTopics} onSelect={handleTopicClick} />

            {/* Input Container */}
            <div className="relative bg-[#12121a] rounded-2xl border border-white/5 focus-within:border-emerald-500/30 transition-colors">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything..."
                rows={1}
                className="w-full bg-transparent text-white placeholder-gray-500 text-sm px-4 py-3.5 pr-14 resize-none focus:outline-none max-h-36 custom-scrollbar"
                disabled={isLoading}
              />
              <button
                onClick={handleSend}
                disabled={!inputValue.trim() || isLoading}
                className={`absolute right-2 bottom-2 p-2 rounded-xl transition-all duration-200 ${
                  inputValue.trim() && !isLoading
                    ? "bg-gradient-to-r from-emerald-500 to-cyan-500 text-white shadow-lg shadow-emerald-500/20 hover:opacity-90"
                    : "bg-white/5 text-gray-500 cursor-not-allowed"
                }`}
              >
                <SendIcon />
              </button>
            </div>

            {/* Disclaimer */}
            <p className="text-center text-[10px] text-gray-600 mt-3">
              NeuralChat can make mistakes. Consider checking important information.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Index;
