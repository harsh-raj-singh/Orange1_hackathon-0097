import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link } from "wouter";

// Types
interface GraphNode {
  id: string;
  label: string;
  type: string;
  connections?: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  cluster?: string;
}

interface GraphEdge {
  source: string;
  target: string;
  strength: number;
  type?: string;
}

interface Insight {
  id: string;
  content: string;
  user_id: string;
  created_at: string;
  topics: string[];
}

interface Conversation {
  id: string;
  summary: string;
  topics: string[];
  created_at: string;
}

interface UserGraphData {
  userId: string;
  stats: {
    conversations: number;
    insights: number;
    topics: number;
    connections: number;
  };
  graph: {
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
  insights: Insight[];
  conversations: Conversation[];
}

interface GlobalGraphData {
  stats: {
    totalTopics: number;
    totalConnections: number;
    totalInsights: number;
    totalConversations: number;
  };
  graph: {
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
  insights: Insight[];
}

// Get userId from localStorage (same as chat page)
const getUserId = (): string => {
  if (typeof window === "undefined") return "anonymous";
  const stored = localStorage.getItem("neuralchat_user_id");
  if (stored) return stored;
  const newId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  localStorage.setItem("neuralchat_user_id", newId);
  return newId;
};

// Cluster colors for different topic categories
const CLUSTER_COLORS: Record<string, { fill: string; stroke: string; glow: string }> = {
  physics: { fill: "#3b82f6", stroke: "#60a5fa", glow: "rgba(59, 130, 246, 0.4)" },
  medical: { fill: "#22c55e", stroke: "#4ade80", glow: "rgba(34, 197, 94, 0.4)" },
  computing: { fill: "#a855f7", stroke: "#c084fc", glow: "rgba(168, 85, 247, 0.4)" },
  biology: { fill: "#14b8a6", stroke: "#2dd4bf", glow: "rgba(20, 184, 166, 0.4)" },
  mathematics: { fill: "#ec4899", stroke: "#f472b6", glow: "rgba(236, 72, 153, 0.4)" },
  default: { fill: "#10b981", stroke: "#34d399", glow: "rgba(16, 185, 129, 0.4)" },
};

// Detect cluster from topic name
const detectCluster = (name: string): string => {
  const lower = name.toLowerCase();
  if (/(quantum|physics|newton|energy|gravity|mechanics|dynamics|motion)/.test(lower)) return "physics";
  if (/(medical|health|surgery|recovery|therapy|knee|doctor|patient)/.test(lower)) return "medical";
  if (/(computer|software|programming|algorithm|ai|machine|neural|network|quantum-computing|qubits|entanglement|superposition)/.test(lower)) return "computing";
  if (/(biology|cell|dna|gene|organism)/.test(lower)) return "biology";
  if (/(math|calculus|algebra|geometry)/.test(lower)) return "mathematics";
  return "default";
};

// Icons
const ArrowLeftIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);

const UserIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const GlobeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const RefreshIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
    <path d="M16 21h5v-5" />
  </svg>
);

// Force simulation hook
const useForceSimulation = (
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number
) => {
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const nodesRef = useRef<GraphNode[]>([]);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    if (nodes.length === 0 || width === 0 || height === 0) return;

    // Initialize nodes with positions
    const initNodes: GraphNode[] = nodes.map((node, i) => {
      const angle = (i / nodes.length) * Math.PI * 2;
      const radius = Math.min(width, height) * 0.3;
      return {
        ...node,
        x: width / 2 + Math.cos(angle) * radius + (Math.random() - 0.5) * 50,
        y: height / 2 + Math.sin(angle) * radius + (Math.random() - 0.5) * 50,
        vx: 0,
        vy: 0,
        cluster: detectCluster(node.id),
      };
    });

    nodesRef.current = initNodes;

    // Build adjacency map
    const adjacency = new Map<string, Set<string>>();
    edges.forEach(edge => {
      if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
      if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
      adjacency.get(edge.source)!.add(edge.target);
      adjacency.get(edge.target)!.add(edge.source);
    });

    let iteration = 0;
    const maxIterations = 200;

    const simulate = () => {
      iteration++;
      const alpha = Math.max(0.01, 1 - iteration / maxIterations);

      nodesRef.current.forEach((node, i) => {
        if (!node.vx) node.vx = 0;
        if (!node.vy) node.vy = 0;

        // Repulsion
        nodesRef.current.forEach((other, j) => {
          if (i === j) return;
          const dx = (node.x || 0) - (other.x || 0);
          const dy = (node.y || 0) - (other.y || 0);
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = 2000 / (dist * dist);
          node.vx! += (dx / dist) * force * alpha;
          node.vy! += (dy / dist) * force * alpha;
        });

        // Attraction to connected nodes
        const connected = adjacency.get(node.id);
        if (connected) {
          connected.forEach(targetId => {
            const target = nodesRef.current.find(n => n.id === targetId);
            if (!target) return;
            const dx = (target.x || 0) - (node.x || 0);
            const dy = (target.y || 0) - (node.y || 0);
            node.vx! += dx * 0.03 * alpha;
            node.vy! += dy * 0.03 * alpha;
          });
        }

        // Center gravity
        node.vx! += (width / 2 - (node.x || 0)) * 0.005 * alpha;
        node.vy! += (height / 2 - (node.y || 0)) * 0.005 * alpha;
      });

      // Apply velocities
      nodesRef.current.forEach(node => {
        node.vx! *= 0.85;
        node.vy! *= 0.85;
        node.x = Math.max(50, Math.min(width - 50, (node.x || 0) + (node.vx || 0)));
        node.y = Math.max(50, Math.min(height - 50, (node.y || 0) + (node.vy || 0)));
      });

      const newPositions = new Map<string, { x: number; y: number }>();
      nodesRef.current.forEach(node => {
        newPositions.set(node.id, { x: node.x || 0, y: node.y || 0 });
      });
      setPositions(newPositions);

      if (iteration < maxIterations) {
        animationRef.current = requestAnimationFrame(simulate);
      }
    };

    animationRef.current = requestAnimationFrame(simulate);

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [nodes, edges, width, height]);

  return { positions, nodes: nodesRef.current };
};

// Graph Visualization Component
const GraphVisualization = ({
  nodes,
  edges,
  selectedNode,
  onSelectNode,
  width,
  height,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNode: string | null;
  onSelectNode: (id: string | null) => void;
  width: number;
  height: number;
}) => {
  const { positions, nodes: simNodes } = useForceSimulation(nodes, edges, width, height);

  const connectedNodes = useMemo(() => {
    if (!selectedNode) return new Set<string>();
    const connected = new Set<string>();
    edges.forEach(edge => {
      if (edge.source === selectedNode) connected.add(edge.target);
      if (edge.target === selectedNode) connected.add(edge.source);
    });
    return connected;
  }, [selectedNode, edges]);

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/10 flex items-center justify-center mb-4">
          <GlobeIcon />
        </div>
        <h3 className="text-lg font-semibold text-white mb-2">No Data Yet</h3>
        <p className="text-gray-500 text-sm">Start chatting to build your knowledge graph</p>
      </div>
    );
  }

  return (
    <svg width={width} height={height} className="cursor-pointer">
      <defs>
        {Object.entries(CLUSTER_COLORS).map(([cluster, colors]) => (
          <filter key={cluster} id={`glow-${cluster}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        ))}
      </defs>

      {/* Edges */}
      {edges.map((edge, i) => {
        const sourcePos = positions.get(edge.source);
        const targetPos = positions.get(edge.target);
        if (!sourcePos || !targetPos) return null;

        const isHighlighted = selectedNode && (edge.source === selectedNode || edge.target === selectedNode);
        const opacity = selectedNode ? (isHighlighted ? 0.8 : 0.1) : 0.3;

        return (
          <line
            key={i}
            x1={sourcePos.x}
            y1={sourcePos.y}
            x2={targetPos.x}
            y2={targetPos.y}
            stroke={isHighlighted ? "#10b981" : "#374151"}
            strokeWidth={isHighlighted ? 2 : 1}
            opacity={opacity}
          />
        );
      })}

      {/* Nodes */}
      {simNodes.map(node => {
        const pos = positions.get(node.id);
        if (!pos) return null;

        const cluster = node.cluster || "default";
        const colors = CLUSTER_COLORS[cluster] || CLUSTER_COLORS.default;
        const isSelected = node.id === selectedNode;
        const isConnected = connectedNodes.has(node.id);
        const opacity = selectedNode ? (isSelected || isConnected ? 1 : 0.3) : 1;
        const radius = isSelected ? 28 : 22;

        return (
          <g
            key={node.id}
            transform={`translate(${pos.x}, ${pos.y})`}
            onClick={() => onSelectNode(isSelected ? null : node.id)}
            style={{ cursor: "pointer", opacity }}
          >
            <circle
              r={radius}
              fill={colors.fill}
              stroke={colors.stroke}
              strokeWidth={isSelected ? 3 : 1.5}
              filter={isSelected ? `url(#glow-${cluster})` : undefined}
            />
            <text
              y={radius + 16}
              textAnchor="middle"
              fill="#e5e7eb"
              fontSize="11"
              fontWeight="500"
            >
              {node.label.length > 15 ? node.label.slice(0, 15) + "..." : node.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

// Main Component
export default function GraphPage() {
  const [activeTab, setActiveTab] = useState<"user" | "global">("user");
  const [userId, setUserId] = useState<string>("");
  const [userGraph, setUserGraph] = useState<UserGraphData | null>(null);
  const [globalGraph, setGlobalGraph] = useState<GlobalGraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Get userId on mount
  useEffect(() => {
    setUserId(getUserId());
  }, []);

  // Fetch data with cache busting
  const fetchData = useCallback(async () => {
    if (!userId) return;
    
    setLoading(true);
    const cacheBuster = `?t=${Date.now()}`;
    try {
      const [userRes, globalRes] = await Promise.all([
        fetch(`/api/graph/user/${userId}/full${cacheBuster}`, { cache: 'no-store' }),
        fetch(`/api/graph/global${cacheBuster}`, { cache: 'no-store' }),
      ]);

      if (userRes.ok) {
        const userData = await userRes.json();
        setUserGraph(userData);
      }

      if (globalRes.ok) {
        const globalData = await globalRes.json();
        setGlobalGraph(globalData);
      }
    } catch (error) {
      console.error("Failed to fetch graph data:", error);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh when page becomes visible (user returns from chat)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && userId) {
        fetchData();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [userId, fetchData]);

  // Handle resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({ width: rect.width, height: rect.height });
      }
    };

    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  const currentGraph = activeTab === "user" ? userGraph : globalGraph;
  const stats = activeTab === "user"
    ? userGraph?.stats
    : globalGraph?.stats && {
        topics: globalGraph.stats.totalTopics,
        connections: globalGraph.stats.totalConnections,
        insights: globalGraph.stats.totalInsights,
        conversations: globalGraph.stats.totalConversations,
      };

  const insights = activeTab === "user" ? userGraph?.insights : globalGraph?.insights;

  // Filter insights for selected node
  const filteredInsights = useMemo(() => {
    if (!selectedNode || !insights) return insights?.slice(0, 5) || [];
    return insights.filter(i => i.topics?.includes(selectedNode)).slice(0, 5);
  }, [selectedNode, insights]);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <header className="border-b border-white/5 bg-[#0a0a0f]/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors">
              <ArrowLeftIcon />
              <span className="hidden sm:inline">Back to Chat</span>
            </Link>
            <div className="h-6 w-px bg-white/10" />
            <h1 className="text-lg font-semibold">Knowledge Graph</h1>
          </div>

          <div className="flex items-center gap-3">
            {/* Tab Switcher */}
            <div className="flex bg-[#1a1a24] rounded-lg p-1">
              <button
                onClick={() => { setActiveTab("user"); setSelectedNode(null); }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  activeTab === "user"
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                <UserIcon />
                My Graph
              </button>
              <button
                onClick={() => { setActiveTab("global"); setSelectedNode(null); }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  activeTab === "global"
                    ? "bg-cyan-500/20 text-cyan-400"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                <GlobeIcon />
                Global
              </button>
            </div>

            <button
              onClick={fetchData}
              className="p-2 rounded-lg bg-[#1a1a24] text-gray-400 hover:text-white transition-colors"
              title="Refresh"
            >
              <RefreshIcon />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* User ID Display */}
        {activeTab === "user" && userId && (
          <div className="mb-4 px-3 py-2 bg-[#12121a] rounded-lg border border-white/5 inline-flex items-center gap-2">
            <UserIcon />
            <span className="text-xs text-gray-400">Your ID:</span>
            <code className="text-xs text-emerald-400 font-mono">{userId}</code>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-[#12121a] rounded-xl border border-white/5 p-4">
            <p className="text-2xl font-bold text-white">{stats?.topics || 0}</p>
            <p className="text-xs text-gray-500">Topics</p>
          </div>
          <div className="bg-[#12121a] rounded-xl border border-white/5 p-4">
            <p className="text-2xl font-bold text-white">{stats?.connections || 0}</p>
            <p className="text-xs text-gray-500">Connections</p>
          </div>
          <div className="bg-[#12121a] rounded-xl border border-white/5 p-4">
            <p className="text-2xl font-bold text-white">{stats?.insights || 0}</p>
            <p className="text-xs text-gray-500">Insights</p>
          </div>
          <div className="bg-[#12121a] rounded-xl border border-white/5 p-4">
            <p className="text-2xl font-bold text-white">{stats?.conversations || 0}</p>
            <p className="text-xs text-gray-500">Conversations</p>
          </div>
        </div>

        {/* Graph + Sidebar */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Graph Area */}
          <div className="lg:col-span-2 bg-[#12121a] rounded-xl border border-white/5 overflow-hidden">
            <div className="p-4 border-b border-white/5 flex items-center justify-between">
              <h2 className="font-medium">
                {activeTab === "user" ? "Your Knowledge Graph" : "Global Knowledge Network"}
              </h2>
              {selectedNode && (
                <button
                  onClick={() => setSelectedNode(null)}
                  className="text-xs text-gray-400 hover:text-white"
                >
                  Clear selection
                </button>
              )}
            </div>
            <div ref={containerRef} className="h-[500px]">
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full" />
                </div>
              ) : currentGraph ? (
                <GraphVisualization
                  nodes={currentGraph.graph.nodes}
                  edges={currentGraph.graph.edges}
                  selectedNode={selectedNode}
                  onSelectNode={setSelectedNode}
                  width={dimensions.width}
                  height={dimensions.height}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-gray-500">
                  No data available
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Selected Node Info */}
            {selectedNode && (
              <div className="bg-[#12121a] rounded-xl border border-emerald-500/30 p-4">
                <h3 className="text-sm font-medium text-emerald-400 mb-2">Selected Topic</h3>
                <p className="text-lg font-semibold text-white mb-3">
                  {selectedNode.replace(/-/g, " ")}
                </p>
                <div className="text-xs text-gray-400">
                  Click on connected nodes to explore
                </div>
              </div>
            )}

            {/* Insights */}
            <div className="bg-[#12121a] rounded-xl border border-white/5 p-4">
              <h3 className="text-sm font-medium text-gray-300 mb-3">
                {selectedNode ? `Insights about "${selectedNode.replace(/-/g, " ")}"` : "Recent Insights"}
              </h3>
              <div className="space-y-3">
                {filteredInsights.length > 0 ? (
                  filteredInsights.map((insight, i) => (
                    <div key={i} className="text-sm text-gray-400 p-2 bg-white/5 rounded-lg">
                      {insight.content}
                      {insight.topics && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {insight.topics.slice(0, 3).map((topic, j) => (
                            <span
                              key={j}
                              className="text-xs px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 rounded"
                            >
                              {topic}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gray-500">No insights yet</p>
                )}
              </div>
            </div>

            {/* Legend */}
            <div className="bg-[#12121a] rounded-xl border border-white/5 p-4">
              <h3 className="text-sm font-medium text-gray-300 mb-3">Topic Categories</h3>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(CLUSTER_COLORS).slice(0, -1).map(([name, colors]) => (
                  <div key={name} className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: colors.fill }}
                    />
                    <span className="text-xs text-gray-400 capitalize">{name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Info Banner */}
      <div className="fixed bottom-4 left-4 right-4 max-w-md mx-auto">
        <div className="bg-[#1a1a24] border border-white/10 rounded-lg p-3 text-center">
          <p className="text-xs text-gray-400">
            {activeTab === "user" ? (
              <>Your personal knowledge graph • <span className="text-emerald-400">Private to you</span></>
            ) : (
              <>Combined knowledge from all users • <span className="text-cyan-400">Anonymized</span></>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
