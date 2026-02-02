import { useState, useEffect, useRef, useCallback, useMemo, Component, ErrorInfo, ReactNode } from "react";
import { Link } from "wouter";
import * as d3 from "d3";

// Types
interface GraphNode {
  id: string;
  label: string;
  type: string;
  frequency?: number; // How often this topic is used
  normalizedFrequency?: number; // 0-1 normalized frequency for sizing
  connections?: number;
  parentId?: string; // For hierarchy
  children?: string[];
}

interface GraphEdge {
  source: string | GraphNode;
  target: string | GraphNode;
  strength: number;
  type?: string;
}

interface D3Node extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  type: string;
  frequency: number;
  normalizedFrequency: number;
  radius: number;
  tier: "large" | "medium" | "small"; // Hierarchical tier
  cluster: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  source: D3Node | string;
  target: D3Node | string;
  strength: number;
}

interface Insight {
  id: string;
  content: string;
  user_id: string;
  created_at: string;
  topics: string[];
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

// Get userId from localStorage
const getUserId = (): string => {
  if (typeof window === "undefined") return "anonymous";
  const stored = localStorage.getItem("neuralchat_user_id");
  if (stored) return stored;
  const newId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  localStorage.setItem("neuralchat_user_id", newId);
  return newId;
};

// Cluster colors
const CLUSTER_COLORS: Record<string, { fill: string; stroke: string }> = {
  physics: { fill: "#3b82f6", stroke: "#60a5fa" },
  medical: { fill: "#22c55e", stroke: "#4ade80" },
  computing: { fill: "#a855f7", stroke: "#c084fc" },
  biology: { fill: "#14b8a6", stroke: "#2dd4bf" },
  mathematics: { fill: "#ec4899", stroke: "#f472b6" },
  finance: { fill: "#f59e0b", stroke: "#fbbf24" },
  gmail: { fill: "#ef4444", stroke: "#f87171" },
  default: { fill: "#10b981", stroke: "#34d399" },
};

// Detect cluster from topic name
const detectCluster = (name: string): string => {
  const lower = name.toLowerCase();
  if (lower.startsWith("gmail-")) return "gmail";
  if (/(quantum|physics|newton|energy|gravity|mechanics)/.test(lower)) return "physics";
  if (/(medical|health|surgery|recovery|therapy|doctor)/.test(lower)) return "medical";
  if (/(computer|software|programming|algorithm|ai|machine|neural|code)/.test(lower)) return "computing";
  if (/(biology|cell|dna|gene|organism)/.test(lower)) return "biology";
  if (/(math|calculus|algebra|geometry|equation)/.test(lower)) return "mathematics";
  if (/(finance|money|invoice|payment|billing|salary)/.test(lower)) return "finance";
  return "default";
};

// Icons
const ArrowLeftIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);

const UserIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const GlobeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const RefreshIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
    <path d="M16 21h5v-5" />
  </svg>
);

const ZoomInIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="11" y1="8" x2="11" y2="14" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </svg>
);

const ZoomOutIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </svg>
);

const CenterIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v4m0 12v4M2 12h4m12 0h4" />
  </svg>
);

// Error boundary for D3 graph
class GraphErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode; fallback?: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Graph rendering error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex flex-col items-center justify-center h-full text-center p-8">
          <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-red-500/20 to-orange-500/10 flex items-center justify-center mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">Graph Rendering Error</h3>
          <p className="text-gray-500 text-sm mb-4">There was an issue displaying the graph</p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-4 py-2 bg-emerald-500/20 text-emerald-400 rounded-lg hover:bg-emerald-500/30 transition-colors"
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// D3 Force Graph Component
const D3ForceGraph = ({
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
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<D3Node, D3Link> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0 || width === 0 || height === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    // HIERARCHICAL NODE SIZING based on FREQUENCY from API
    // Nodes come with normalizedFrequency (0-1) from the API
    // Tier: top 20% = large, 20-60% = medium, bottom 40% = small
    const d3Nodes: D3Node[] = nodes.map(node => {
      // Use normalizedFrequency from API, or fall back to connections-based calculation
      const normFreq = node.normalizedFrequency ?? (node.frequency ? node.frequency / Math.max(...nodes.map(n => n.frequency || 1), 1) : 0.5);
      
      // Determine tier based on normalized frequency
      let tier: "large" | "medium" | "small";
      let radius: number;
      
      if (normFreq >= 0.6) {
        tier = "large";
        radius = 35 + (normFreq - 0.6) * 50; // 35-55
      } else if (normFreq >= 0.2) {
        tier = "medium";
        radius = 20 + (normFreq - 0.2) * 37.5; // 20-35
      } else {
        tier = "small";
        radius = 12 + normFreq * 40; // 12-20
      }
      
      return {
        id: node.id,
        label: node.label,
        type: node.type,
        frequency: node.frequency || 1,
        normalizedFrequency: normFreq,
        radius,
        tier,
        cluster: detectCluster(node.id),
      };
    });

    // Create D3 links - filter out edges with missing nodes
    const nodeIds = new Set(d3Nodes.map(n => n.id));
    const d3Links: D3Link[] = edges
      .map(edge => ({
        source: typeof edge.source === 'string' ? edge.source : edge.source.id,
        target: typeof edge.target === 'string' ? edge.target : edge.target.id,
        strength: edge.strength,
      }))
      .filter(link => {
        const sourceExists = nodeIds.has(link.source as string);
        const targetExists = nodeIds.has(link.target as string);
        if (!sourceExists || !targetExists) {
          console.warn(`Skipping edge with missing node: ${link.source} -> ${link.target}`);
          return false;
        }
        return true;
      });

    // Create container group for zoom/pan
    const g = svg.append("g").attr("class", "graph-container");

    // Setup zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    svg.call(zoom);
    zoomRef.current = zoom;

    // Initial center
    svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(0.8).translate(-width / 2, -height / 2));

    // Create arrow markers for directed edges
    svg.append("defs").append("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "-0 -5 10 10")
      .attr("refX", 20)
      .attr("refY", 0)
      .attr("orient", "auto")
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .append("path")
      .attr("d", "M 0,-5 L 10,0 L 0,5")
      .attr("fill", "#374151");

    // Create links
    const link = g.append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(d3Links)
      .join("line")
      .attr("stroke", "#374151")
      .attr("stroke-opacity", 0.4)
      .attr("stroke-width", d => Math.max(1, d.strength * 3));

    // Create node groups
    const node = g.append("g")
      .attr("class", "nodes")
      .selectAll("g")
      .data(d3Nodes)
      .join("g")
      .attr("class", "node")
      .style("cursor", "pointer")
      .call(d3.drag<SVGGElement, D3Node>()
        .on("start", (event, d) => {
          if (!event.active) simulationRef.current?.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on("end", (event, d) => {
          if (!event.active) simulationRef.current?.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        })
      );

    // Node circles
    node.append("circle")
      .attr("r", d => d.radius)
      .attr("fill", d => CLUSTER_COLORS[d.cluster]?.fill || CLUSTER_COLORS.default.fill)
      .attr("stroke", d => CLUSTER_COLORS[d.cluster]?.stroke || CLUSTER_COLORS.default.stroke)
      .attr("stroke-width", 2)
      .on("click", (event, d) => {
        event.stopPropagation();
        onSelectNode(d.id === selectedNode ? null : d.id);
      })
      .on("mouseover", function() {
        d3.select(this).attr("stroke-width", 4);
      })
      .on("mouseout", function() {
        d3.select(this).attr("stroke-width", 2);
      });

    // Node labels
    node.append("text")
      .text(d => d.label.length > 12 ? d.label.slice(0, 12) + "..." : d.label)
      .attr("text-anchor", "middle")
      .attr("dy", d => d.radius + 14)
      .attr("fill", "#e5e7eb")
      .attr("font-size", d => Math.max(10, Math.min(12, d.radius / 2)))
      .attr("font-weight", "500")
      .style("pointer-events", "none");

    // Frequency indicator (small badge)
    node.append("text")
      .text(d => d.frequency > 1 ? d.frequency : "")
      .attr("text-anchor", "middle")
      .attr("dy", 4)
      .attr("fill", "#fff")
      .attr("font-size", d => Math.max(8, d.radius / 3))
      .attr("font-weight", "bold")
      .style("pointer-events", "none");

    // Create force simulation
    const simulation = d3.forceSimulation<D3Node>(d3Nodes)
      .force("link", d3.forceLink<D3Node, D3Link>(d3Links)
        .id(d => d.id)
        .distance(d => {
          const sourceNode = d3Nodes.find(n => n.id === (typeof d.source === 'string' ? d.source : d.source.id));
          const targetNode = d3Nodes.find(n => n.id === (typeof d.target === 'string' ? d.target : d.target.id));
          return (sourceNode?.radius || 20) + (targetNode?.radius || 20) + 50;
        })
        .strength(0.5)
      )
      .force("charge", d3.forceManyBody<D3Node>()
        .strength(d => -d.radius * 15)
      )
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide<D3Node>()
        .radius(d => d.radius + 10)
      )
      .force("x", d3.forceX(width / 2).strength(0.05))
      .force("y", d3.forceY(height / 2).strength(0.05));

    simulationRef.current = simulation;

    // Update positions on tick
    simulation.on("tick", () => {
      link
        .attr("x1", d => (d.source as D3Node).x || 0)
        .attr("y1", d => (d.source as D3Node).y || 0)
        .attr("x2", d => (d.target as D3Node).x || 0)
        .attr("y2", d => (d.target as D3Node).y || 0);

      node.attr("transform", d => `translate(${d.x || 0},${d.y || 0})`);
    });

    // Click on background to deselect
    svg.on("click", () => onSelectNode(null));

    // Cleanup
    return () => {
      simulation.stop();
    };
  }, [nodes, edges, width, height, onSelectNode]);

  // Update selected node highlighting
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);

    const connectedNodes = new Set<string>();
    if (selectedNode) {
      edges.forEach(edge => {
        const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
        const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
        if (sourceId === selectedNode) connectedNodes.add(targetId);
        if (targetId === selectedNode) connectedNodes.add(sourceId);
      });
    }

    svg.selectAll(".node circle")
      .attr("opacity", (d: any) => {
        if (!selectedNode) return 1;
        return d.id === selectedNode || connectedNodes.has(d.id) ? 1 : 0.2;
      })
      .attr("stroke-width", (d: any) => d.id === selectedNode ? 4 : 2);

    svg.selectAll(".links line")
      .attr("stroke-opacity", (d: any) => {
        if (!selectedNode) return 0.4;
        const sourceId = typeof d.source === 'string' ? d.source : d.source.id;
        const targetId = typeof d.target === 'string' ? d.target : d.target.id;
        return sourceId === selectedNode || targetId === selectedNode ? 0.8 : 0.1;
      })
      .attr("stroke", (d: any) => {
        const sourceId = typeof d.source === 'string' ? d.source : d.source.id;
        const targetId = typeof d.target === 'string' ? d.target : d.target.id;
        return sourceId === selectedNode || targetId === selectedNode ? "#10b981" : "#374151";
      });
  }, [selectedNode, edges]);

  // Zoom controls
  const handleZoom = (scale: number) => {
    if (!svgRef.current || !zoomRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.transition().duration(300).call(
      zoomRef.current.scaleBy,
      scale
    );
  };

  const handleCenter = () => {
    if (!svgRef.current || !zoomRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.transition().duration(500).call(
      zoomRef.current.transform,
      d3.zoomIdentity.translate(width / 2, height / 2).scale(0.8).translate(-width / 2, -height / 2)
    );
  };

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
    <div className="relative w-full h-full">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="bg-[#0d0d14]"
      />
      {/* Zoom controls */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-2">
        <button
          onClick={() => handleZoom(1.3)}
          className="p-2 bg-[#1a1a24] rounded-lg text-gray-400 hover:text-white transition-colors"
          title="Zoom In"
        >
          <ZoomInIcon />
        </button>
        <button
          onClick={() => handleZoom(0.7)}
          className="p-2 bg-[#1a1a24] rounded-lg text-gray-400 hover:text-white transition-colors"
          title="Zoom Out"
        >
          <ZoomOutIcon />
        </button>
        <button
          onClick={handleCenter}
          className="p-2 bg-[#1a1a24] rounded-lg text-gray-400 hover:text-white transition-colors"
          title="Center"
        >
          <CenterIcon />
        </button>
      </div>
      {/* Instructions */}
      <div className="absolute top-4 left-4 text-xs text-gray-500">
        Drag nodes • Scroll to zoom • Click to select
      </div>
    </div>
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

  useEffect(() => {
    setUserId(getUserId());
  }, []);

  const fetchData = useCallback(async () => {
    if (!userId) return;
    
    setLoading(true);
    const cacheBuster = `?t=${Date.now()}`;
    try {
      const [userRes, globalRes] = await Promise.all([
        fetch(`/api/graph/user/${userId}/full${cacheBuster}`, { cache: 'no-store' }),
        fetch(`/api/graph/global${cacheBuster}`, { cache: 'no-store' }),
      ]);

      if (userRes.ok) setUserGraph(await userRes.json());
      if (globalRes.ok) setGlobalGraph(await globalRes.json());
    } catch (error) {
      console.error("Failed to fetch graph data:", error);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && userId) fetchData();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [userId, fetchData]);

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
                <GraphErrorBoundary>
                  <D3ForceGraph
                    nodes={currentGraph.graph.nodes}
                    edges={currentGraph.graph.edges}
                    selectedNode={selectedNode}
                    onSelectNode={setSelectedNode}
                    width={dimensions.width}
                    height={dimensions.height}
                  />
                </GraphErrorBoundary>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-500">
                  No data available
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
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
                              className="text-xs px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 rounded cursor-pointer hover:bg-emerald-500/20"
                              onClick={() => setSelectedNode(topic)}
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
                {Object.entries(CLUSTER_COLORS).filter(([k]) => k !== 'default').map(([name, colors]) => (
                  <div key={name} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: colors.fill }} />
                    <span className="text-xs text-gray-400 capitalize">{name}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Size Legend */}
            <div className="bg-[#12121a] rounded-xl border border-white/5 p-4">
              <h3 className="text-sm font-medium text-gray-300 mb-3">Node Size = Frequency</h3>
              <div className="flex items-center gap-4 justify-center">
                <div className="flex flex-col items-center">
                  <div className="w-4 h-4 rounded-full bg-gray-500"></div>
                  <span className="text-xs text-gray-500 mt-1">Rare</span>
                </div>
                <div className="flex flex-col items-center">
                  <div className="w-6 h-6 rounded-full bg-gray-500"></div>
                  <span className="text-xs text-gray-500 mt-1">Common</span>
                </div>
                <div className="flex flex-col items-center">
                  <div className="w-10 h-10 rounded-full bg-gray-500"></div>
                  <span className="text-xs text-gray-500 mt-1">Popular</span>
                </div>
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
