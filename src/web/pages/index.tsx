import { useState, useRef, useEffect } from "react";

interface Message {
  id: string;
  role: "user" | "ai";
  content: string;
  source?: string;
}

interface Session {
  id: string;
  title: string;
  preview: string;
  timestamp: string;
}

const INITIAL_SESSIONS: Session[] = [
  { id: "1", title: "Project Discussion", preview: "Let's review the architecture...", timestamp: "2 hours ago" },
  { id: "2", title: "Code Review", preview: "The refactoring looks good...", timestamp: "Yesterday" },
  { id: "3", title: "Research Notes", preview: "Found some interesting papers...", timestamp: "3 days ago" },
  { id: "4", title: "Bug Investigation", preview: "The issue seems to be in...", timestamp: "1 week ago" },
  { id: "5", title: "Feature Planning", preview: "We should consider adding...", timestamp: "2 weeks ago" },
];

const INITIAL_MESSAGES: Message[] = [
  { id: "1", role: "ai", content: "Hello! I'm your AI assistant powered by Graph Memory. How can I help you today?", source: "Graph Memory" },
  { id: "2", role: "user", content: "Can you explain how the memory system works?" },
  { id: "3", role: "ai", content: "The Graph Memory system stores information as interconnected nodes, allowing for contextual retrieval based on relationships rather than just keywords. This means I can understand context and provide more relevant responses by tracing connections between concepts.", source: "Graph Memory" },
];

const AI_RESPONSES = [
  "That's an interesting question! Based on my understanding, I'd suggest exploring that angle further.",
  "Great point! Let me think about this... I believe the key insight here is the relationship between those concepts.",
  "I've processed your input and here's what I found in my knowledge graph.",
  "That's a fascinating topic! My graph memory suggests several related concepts we could explore.",
  "Absolutely! Let me retrieve some relevant context from my memory banks.",
];

function Index() {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [inputValue, setInputValue] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeSession, setActiveSession] = useState("1");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = () => {
    if (!inputValue.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: inputValue.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");

    // Simulate AI response
    setTimeout(() => {
      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        role: "ai",
        content: AI_RESPONSES[Math.floor(Math.random() * AI_RESPONSES.length)],
        source: "Graph Memory",
      };
      setMessages((prev) => [...prev, aiResponse]);
    }, 800);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-[#0a0a0f] font-sans">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:relative inset-y-0 left-0 z-50
        w-72 flex flex-col
        bg-gradient-to-b from-[#12121a] to-[#0d0d14]
        border-r border-[#1f1f2e]
        transform transition-transform duration-300 ease-out
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
      `}>
        {/* Sidebar header */}
        <div className="p-4 border-b border-[#1f1f2e]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <h1 className="font-bold text-white tracking-tight">NeuralChat</h1>
              <p className="text-xs text-[#6b6b8a]">Graph Memory Active</p>
            </div>
          </div>
        </div>

        {/* New chat button */}
        <div className="p-3">
          <button className="
            w-full py-3 px-4 rounded-xl
            bg-gradient-to-r from-emerald-500/10 to-cyan-500/10
            border border-emerald-500/30
            text-emerald-400 font-medium text-sm
            flex items-center justify-center gap-2
            hover:from-emerald-500/20 hover:to-cyan-500/20
            hover:border-emerald-500/50
            transition-all duration-200
            group
          ">
            <svg className="w-4 h-4 transition-transform group-hover:rotate-90 duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Chat
          </button>
        </div>

        {/* Sessions list */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          <p className="text-[10px] uppercase tracking-widest text-[#4a4a6a] font-semibold mb-3 px-2">Recent Sessions</p>
          <nav className="space-y-1">
            {INITIAL_SESSIONS.map((session) => (
              <button
                key={session.id}
                onClick={() => {
                  setActiveSession(session.id);
                  setSidebarOpen(false);
                }}
                className={`
                  w-full text-left p-3 rounded-xl
                  transition-all duration-200
                  group relative
                  ${activeSession === session.id 
                    ? "bg-gradient-to-r from-emerald-500/15 to-cyan-500/10 border border-emerald-500/20" 
                    : "hover:bg-[#1a1a28] border border-transparent"}
                `}
              >
                <div className="flex items-start gap-3">
                  <div className={`
                    w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5
                    ${activeSession === session.id 
                      ? "bg-emerald-500/20 text-emerald-400" 
                      : "bg-[#1f1f2e] text-[#6b6b8a] group-hover:bg-[#252535] group-hover:text-[#8b8baa]"}
                    transition-colors duration-200
                  `}>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium text-sm truncate ${activeSession === session.id ? "text-white" : "text-[#a0a0ba]"}`}>
                      {session.title}
                    </p>
                    <p className="text-xs text-[#5a5a7a] truncate mt-0.5">{session.preview}</p>
                    <p className="text-[10px] text-[#4a4a6a] mt-1">{session.timestamp}</p>
                  </div>
                </div>
              </button>
            ))}
          </nav>
        </div>

        {/* Sidebar footer */}
        <div className="p-3 border-t border-[#1f1f2e]">
          <div className="flex items-center gap-3 p-2 rounded-xl hover:bg-[#1a1a28] transition-colors cursor-pointer">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white text-sm font-semibold">
              U
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">User</p>
              <p className="text-xs text-[#6b6b8a]">Free Plan</p>
            </div>
            <svg className="w-4 h-4 text-[#6b6b8a]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-16 border-b border-[#1f1f2e] flex items-center px-4 gap-4 bg-[#0d0d14]/80 backdrop-blur-xl shrink-0">
          {/* Mobile menu button */}
          <button 
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 rounded-lg hover:bg-[#1a1a28] text-[#8b8baa] transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-white truncate">
              {INITIAL_SESSIONS.find(s => s.id === activeSession)?.title || "New Chat"}
            </h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-[#6b6b8a]">Connected to Graph Memory</span>
            </div>
          </div>

          <button className="p-2 rounded-lg hover:bg-[#1a1a28] text-[#8b8baa] transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
          </button>
        </header>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto scroll-smooth">
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
            {messages.map((message, index) => (
              <div
                key={message.id}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"} animate-message-in`}
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div className={`
                  flex gap-3 max-w-[85%] md:max-w-[75%]
                  ${message.role === "user" ? "flex-row-reverse" : "flex-row"}
                `}>
                  {/* Avatar */}
                  <div className={`
                    w-8 h-8 rounded-lg shrink-0 flex items-center justify-center
                    ${message.role === "user" 
                      ? "bg-gradient-to-br from-violet-500 to-fuchsia-500" 
                      : "bg-gradient-to-br from-emerald-400 to-cyan-500"}
                    shadow-lg
                    ${message.role === "user" ? "shadow-violet-500/20" : "shadow-emerald-500/20"}
                  `}>
                    {message.role === "user" ? (
                      <span className="text-white text-xs font-semibold">U</span>
                    ) : (
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    )}
                  </div>

                  {/* Message bubble */}
                  <div className={`
                    relative rounded-2xl px-4 py-3
                    ${message.role === "user" 
                      ? "bg-gradient-to-br from-violet-600/90 to-fuchsia-600/90 text-white rounded-tr-sm" 
                      : "bg-[#16161f] border border-[#252535] text-[#e0e0f0] rounded-tl-sm"}
                  `}>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
                    
                    {/* Source badge for AI messages */}
                    {message.role === "ai" && message.source && (
                      <div className="mt-2 flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                          </svg>
                          Source: {message.source}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input area */}
        <div className="border-t border-[#1f1f2e] p-4 bg-gradient-to-t from-[#0a0a0f] to-transparent">
          <div className="max-w-3xl mx-auto">
            <div className="relative flex items-end gap-3 bg-[#12121a] rounded-2xl border border-[#252535] p-3 focus-within:border-emerald-500/50 transition-colors shadow-xl shadow-black/20">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Send a message..."
                rows={1}
                className="
                  flex-1 bg-transparent text-white placeholder-[#5a5a7a]
                  resize-none outline-none text-sm leading-6
                  max-h-32 min-h-[24px]
                "
                style={{ 
                  height: "auto",
                  overflow: inputValue.split("\n").length > 4 ? "auto" : "hidden" 
                }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = "auto";
                  target.style.height = Math.min(target.scrollHeight, 128) + "px";
                }}
              />
              
              <button
                onClick={handleSend}
                disabled={!inputValue.trim()}
                className={`
                  p-2.5 rounded-xl shrink-0
                  transition-all duration-200 ease-out
                  ${inputValue.trim() 
                    ? "bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:shadow-lg hover:shadow-emerald-500/25 hover:scale-105" 
                    : "bg-[#1f1f2e] text-[#4a4a6a] cursor-not-allowed"}
                `}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
            
            <p className="text-center text-[10px] text-[#4a4a6a] mt-3">
              NeuralChat may produce inaccurate information. Consider verifying important facts.
            </p>
          </div>
        </div>
      </main>

      {/* Animations */}
      <style>{`
        @keyframes message-in {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .animate-message-in {
          animation: message-in 0.3s ease-out forwards;
        }
        
        /* Custom scrollbar */
        ::-webkit-scrollbar {
          width: 6px;
        }
        
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        
        ::-webkit-scrollbar-thumb {
          background: #2a2a3a;
          border-radius: 3px;
        }
        
        ::-webkit-scrollbar-thumb:hover {
          background: #3a3a4a;
        }
      `}</style>
    </div>
  );
}

export default Index;
