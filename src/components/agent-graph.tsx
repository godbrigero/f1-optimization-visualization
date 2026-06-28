"use client";

import { Activity, GitBranch, PanelLeft, RotateCcw, X } from "lucide-react";
import { type PointerEvent, type WheelEvent, useEffect, useRef, useState } from "react";

type AgentNode = {
  id: string;
  model: string;
  description: string;
  terminal?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
};

type AgentEdge = {
  from: string;
  to: string;
  primary?: boolean;
};

type Iteration = {
  id: number;
  name: string;
  description: string;
  mermaid: string;
};

type AddIterationDetail = {
  description?: string;
  mermaid?: string;
  name?: string;
};

type IterationWindow = Window & {
  addAgentGraphIteration?: (detail?: AddIterationDetail) => void;
};

type GraphViewBox = {
  height: number;
  width: number;
  x: number;
  y: number;
};

const nodes: AgentNode[] = [
  {
    id: "input",
    model: "Input",
    description: "request + source data",
    terminal: true,
    x: 600,
    y: 78,
    width: 330,
    height: 104,
  },
  {
    id: "ingest",
    model: "Ingest Agent",
    description: "captures events",
    x: 600,
    y: 190,
    width: 246,
    height: 78,
  },
  {
    id: "router",
    model: "Router Agent",
    description: "assigns tasks",
    x: 600,
    y: 320,
    width: 246,
    height: 78,
  },
  {
    id: "planner",
    model: "Planner Model",
    description: "builds sequence",
    x: 318,
    y: 462,
    width: 238,
    height: 78,
  },
  {
    id: "reasoner",
    model: "Reasoner Model",
    description: "solves state",
    x: 600,
    y: 462,
    width: 244,
    height: 78,
  },
  {
    id: "tools",
    model: "Tool Agent",
    description: "executes calls",
    x: 882,
    y: 462,
    width: 232,
    height: 78,
  },
  {
    id: "review",
    model: "Review Agent",
    description: "validates output",
    x: 600,
    y: 612,
    width: 246,
    height: 78,
  },
  {
    id: "output",
    model: "Output",
    description: "answer + actions",
    terminal: true,
    x: 600,
    y: 744,
    width: 250,
    height: 76,
  },
];

const edges: AgentEdge[] = [
  { from: "input", to: "ingest", primary: true },
  { from: "ingest", to: "router", primary: true },
  { from: "router", to: "planner", primary: true },
  { from: "router", to: "reasoner", primary: true },
  { from: "router", to: "tools", primary: true },
  { from: "planner", to: "review", primary: true },
  { from: "reasoner", to: "review", primary: true },
  { from: "tools", to: "review", primary: true },
  { from: "review", to: "output", primary: true },
];

const mermaidGraph = `flowchart TD
  input([Input<br/>request + source data])
  ingest["Ingest Agent<br/>captures events"]
  router["Router Agent<br/>assigns tasks"]
  planner["Planner Model<br/>builds sequence"]
  reasoner["Reasoner Model<br/>solves state"]
  tools["Tool Agent<br/>executes calls"]
  review["Review Agent<br/>validates output"]
  output([Output<br/>answer + actions])

  input --> ingest
  ingest --> router
  router --> planner
  router --> reasoner
  router --> tools
  planner --> review
  reasoner --> review
  tools --> review
  review --> output

  classDef terminal fill:#101010,stroke:#ffffff,color:#ffffff,stroke-width:1.4px
  classDef model fill:#050505,stroke:#ffffff,color:#ffffff,stroke-width:1px
  class input,output terminal
  class ingest,router,planner,reasoner,tools,review model`;

function getNode(id: string) {
  const node = nodes.find((agentNode) => agentNode.id === id);

  if (!node) {
    throw new Error(`Unknown agent node: ${id}`);
  }

  return node;
}

function edgePoint(from: AgentNode, to: AgentNode) {
  const halfWidth = from.width / 2;
  const halfHeight = from.height / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const scale = Math.min(
    Math.abs(dx) > 0 ? halfWidth / Math.abs(dx) : Number.POSITIVE_INFINITY,
    Math.abs(dy) > 0 ? halfHeight / Math.abs(dy) : Number.POSITIVE_INFINITY,
  );

  return {
    x: from.x + dx * scale,
    y: from.y + dy * scale,
  };
}

function connectorPath(start: { x: number; y: number }, end: { x: number; y: number }) {
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);

  if (dy > dx * 1.5) {
    return `M ${start.x} ${start.y} C ${start.x} ${start.y + dy * 0.42}, ${end.x} ${
      end.y - dy * 0.42
    }, ${end.x} ${end.y}`;
  }

  return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
}

const flowCycleSeconds = 8;
const edgeTravelSeconds = 0.85;
const nodeProcessingSeconds = 0.55;

const edgeStartSeconds: Record<string, number> = {
  "input->ingest": 0,
  "ingest->router": 1.5,
  "router->planner": 3,
  "router->reasoner": 3,
  "router->tools": 3,
  "planner->review": 4.6,
  "reasoner->review": 4.6,
  "tools->review": 4.6,
  "review->output": 6.2,
};

const initialViewBox: GraphViewBox = {
  x: 160,
  y: 20,
  width: 880,
  height: 780,
};

const minZoomWidth = 520;
const maxZoomWidth = 1400;

function edgeKey(edge: AgentEdge) {
  return `${edge.from}->${edge.to}`;
}

function edgeBegin(edge: AgentEdge) {
  return edgeStartSeconds[edgeKey(edge)] ?? 0;
}

function isDefaultViewBox(viewBox: GraphViewBox) {
  return (
    Math.abs(viewBox.x - initialViewBox.x) < 0.5 &&
    Math.abs(viewBox.y - initialViewBox.y) < 0.5 &&
    Math.abs(viewBox.width - initialViewBox.width) < 0.5 &&
    Math.abs(viewBox.height - initialViewBox.height) < 0.5
  );
}

export function AgentGraph() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isRunProgressMounted, setIsRunProgressMounted] = useState(false);
  const [isRunProgressVisible, setIsRunProgressVisible] = useState(false);
  const [iterations, setIterations] = useState<Iteration[]>([
    {
      id: 1,
      name: "Iteration 1",
      description: "Six-node procedural pipeline",
      mermaid: mermaidGraph,
    },
  ]);
  const [conversationSummary] = useState(() => {
    if (typeof window === "undefined") {
      return "";
    }

    return window.sessionStorage.getItem("f1-agent-conversation-summary") ?? "";
  });
  const [activeIterationId, setActiveIterationId] = useState(1);
  const [viewBox, setViewBox] = useState<GraphViewBox>(initialViewBox);
  const [isPanning, setIsPanning] = useState(false);
  const lastPointerPosition = useRef<{ x: number; y: number } | null>(null);
  const viewBoxRef = useRef<GraphViewBox>(initialViewBox);
  const zoomAnimationFrame = useRef<number | null>(null);
  const runProgressAnimationFrame = useRef<number | null>(null);
  const runProgressCloseTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function appendIteration(detail: AddIterationDetail = {}) {
      setIterations((currentIterations) => {
        const nextId = Math.max(0, ...currentIterations.map((iteration) => iteration.id)) + 1;

        setActiveIterationId(nextId);
        setIsSidebarOpen(true);

        return [
          ...currentIterations,
          {
            id: nextId,
            name: detail.name ?? `Iteration ${nextId}`,
            description: detail.description ?? "LLM generated graph",
            mermaid: detail.mermaid ?? mermaidGraph,
          },
        ];
      });
    }

    function handleAddIteration(event: Event) {
      const customEvent = event as CustomEvent<AddIterationDetail>;
      appendIteration(customEvent.detail);
    }

    const iterationWindow = window as IterationWindow;

    iterationWindow.addAgentGraphIteration = appendIteration;
    window.addEventListener("agent-graph:add-iteration", handleAddIteration);

    return () => {
      if (zoomAnimationFrame.current) {
        cancelAnimationFrame(zoomAnimationFrame.current);
      }
      if (runProgressAnimationFrame.current) {
        cancelAnimationFrame(runProgressAnimationFrame.current);
      }
      if (runProgressCloseTimeout.current) {
        clearTimeout(runProgressCloseTimeout.current);
      }

      delete iterationWindow.addAgentGraphIteration;
      window.removeEventListener("agent-graph:add-iteration", handleAddIteration);
    };
  }, []);

  useEffect(() => {
    viewBoxRef.current = viewBox;
  }, [viewBox]);

  function animateViewBox(targetViewBox: GraphViewBox) {
    if (zoomAnimationFrame.current) {
      cancelAnimationFrame(zoomAnimationFrame.current);
    }

    const startViewBox = viewBoxRef.current;
    const startedAt = performance.now();
    const durationMs = 140;

    function tick(now: number) {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const easedProgress = 1 - (1 - progress) ** 3;
      const nextViewBox = {
        x: startViewBox.x + (targetViewBox.x - startViewBox.x) * easedProgress,
        y: startViewBox.y + (targetViewBox.y - startViewBox.y) * easedProgress,
        width: startViewBox.width + (targetViewBox.width - startViewBox.width) * easedProgress,
        height:
          startViewBox.height + (targetViewBox.height - startViewBox.height) * easedProgress,
      };

      viewBoxRef.current = nextViewBox;
      setViewBox(nextViewBox);

      if (progress < 1) {
        zoomAnimationFrame.current = requestAnimationFrame(tick);
      }
    }

    zoomAnimationFrame.current = requestAnimationFrame(tick);
  }

  function handlePointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    if (zoomAnimationFrame.current) {
      cancelAnimationFrame(zoomAnimationFrame.current);
    }
    lastPointerPosition.current = { x: event.clientX, y: event.clientY };
    setIsPanning(true);
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!isPanning || !lastPointerPosition.current) {
      return;
    }

    event.preventDefault();
    const lastPosition = lastPointerPosition.current;
    const deltaX = event.clientX - lastPosition.x;
    const deltaY = event.clientY - lastPosition.y;
    const bounds = event.currentTarget.getBoundingClientRect();

    lastPointerPosition.current = { x: event.clientX, y: event.clientY };

    setViewBox((currentViewBox) => ({
      ...currentViewBox,
      x: currentViewBox.x - (deltaX * currentViewBox.width) / bounds.width,
      y: currentViewBox.y - (deltaY * currentViewBox.height) / bounds.height,
    }));
  }

  function handlePointerUp(event: PointerEvent<SVGSVGElement>) {
    event.currentTarget.releasePointerCapture(event.pointerId);
    lastPointerPosition.current = null;
    setIsPanning(false);
  }

  function handleWheel(event: WheelEvent<SVGSVGElement>) {
    event.preventDefault();

    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = (event.clientX - bounds.left) / bounds.width;
    const pointerY = (event.clientY - bounds.top) / bounds.height;
    const zoomFactor = event.deltaY > 0 ? 1.12 : 0.88;

    const currentViewBox = viewBoxRef.current;
    const nextWidth = Math.min(maxZoomWidth, Math.max(minZoomWidth, currentViewBox.width * zoomFactor));
    const scale = nextWidth / currentViewBox.width;
    const nextHeight = currentViewBox.height * scale;
    const focalX = currentViewBox.x + pointerX * currentViewBox.width;
    const focalY = currentViewBox.y + pointerY * currentViewBox.height;

    animateViewBox({
      x: focalX - pointerX * nextWidth,
      y: focalY - pointerY * nextHeight,
      width: nextWidth,
      height: nextHeight,
    });
  }

  function resetView() {
    animateViewBox(initialViewBox);
  }

  function openRunProgress() {
    if (runProgressCloseTimeout.current) {
      clearTimeout(runProgressCloseTimeout.current);
    }
    if (runProgressAnimationFrame.current) {
      cancelAnimationFrame(runProgressAnimationFrame.current);
    }

    setIsRunProgressMounted(true);
    runProgressAnimationFrame.current = requestAnimationFrame(() => {
      setIsRunProgressVisible(true);
    });
  }

  function closeRunProgress() {
    if (runProgressCloseTimeout.current) {
      clearTimeout(runProgressCloseTimeout.current);
    }
    if (runProgressAnimationFrame.current) {
      cancelAnimationFrame(runProgressAnimationFrame.current);
    }

    setIsRunProgressVisible(false);
    runProgressCloseTimeout.current = setTimeout(() => {
      setIsRunProgressMounted(false);
    }, 90);
  }

  const hasMovedView = !isDefaultViewBox(viewBox);
  const isRunProgressActive = isRunProgressVisible;

  return (
    <main
      className={`relative min-h-screen overflow-hidden bg-black text-white ${
        isPanning ? "select-none" : ""
      }`}
    >
      <h1 className="sr-only">Interconnected agent node graph</h1>

      {conversationSummary ? (
        <section className="absolute left-1/2 top-5 z-20 w-[min(760px,calc(100vw-2.5rem))] -translate-x-1/2 rounded-md border border-white/14 bg-black/82 px-4 py-3 shadow-[0_18px_50px_rgba(0,0,0,0.38)] backdrop-blur-xl">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/38">
            Conversation summary
          </div>
          <p className="mt-2 line-clamp-3 text-sm leading-6 text-white/72">{conversationSummary}</p>
        </section>
      ) : null}

      <button
        type="button"
        aria-label="Open iterations"
        onClick={() => setIsSidebarOpen(true)}
        className={`absolute left-5 top-5 z-20 inline-flex h-9 items-center gap-2 rounded-md border border-white/14 bg-black/80 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-white/72 outline-none transition hover:border-white/28 hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 ${
          isSidebarOpen ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        <PanelLeft className="size-4" />
        Iterations
      </button>

      <div
        className={`absolute right-5 top-5 z-20 flex items-center gap-2 transition-opacity ${
          isRunProgressActive ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        {hasMovedView ? (
          <button
            type="button"
            onClick={resetView}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-white/14 bg-black/80 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-white/72 outline-none transition hover:border-white/28 hover:text-white focus-visible:ring-2 focus-visible:ring-white/35"
          >
            <RotateCcw className="size-4" />
            Reset view
          </button>
        ) : null}

        <button
          type="button"
          aria-label="Open run progress"
          onClick={openRunProgress}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-white/14 bg-black/80 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-white/72 outline-none transition hover:border-white/28 hover:text-white focus-visible:ring-2 focus-visible:ring-white/35"
        >
          <Activity className="size-4" />
          Run Progress
        </button>
      </div>

      <aside
        aria-label="Iterations"
        aria-hidden={!isSidebarOpen}
        className={`absolute inset-y-0 left-0 z-30 w-[300px] border-r border-white/12 bg-black/92 transform-gpu will-change-transform transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isSidebarOpen
            ? "translate-x-0"
            : "pointer-events-none -translate-x-[calc(100%+1px)]"
        }`}
      >
          <div className="flex h-14 items-center justify-between border-b border-white/10 px-4">
            <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.16em] text-white/70">
              <GitBranch className="size-4" />
              Iterations
            </div>
            <button
              type="button"
              onClick={() => setIsSidebarOpen(false)}
              aria-label="Close iterations"
              className="inline-flex size-8 items-center justify-center rounded-md text-white/60 outline-none transition hover:bg-white/8 hover:text-white focus-visible:ring-2 focus-visible:ring-white/35"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="px-4 py-3">
            <div className="space-y-2">
              {iterations.map((iteration) => (
                <button
                  key={iteration.id}
                  type="button"
                  onClick={() => setActiveIterationId(iteration.id)}
                  className={`group w-full rounded-md border px-3 py-3 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-white/35 ${
                    iteration.id === activeIterationId
                      ? "border-white/44 bg-white/[0.075] text-white"
                      : "border-white/12 bg-black text-white/54 hover:border-white/28 hover:bg-white/[0.035] hover:text-white/80"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{iteration.name}</div>
                      <div className="mt-1 truncate text-xs text-white/38">
                        {iteration.description}
                      </div>
                    </div>
                    <div className="shrink-0 rounded-sm border border-white/12 px-1.5 py-0.5 font-mono text-[10px] text-white/36">
                      {String(iteration.id).padStart(2, "0")}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <span
                      className={`h-px flex-1 ${
                        iteration.id === activeIterationId ? "bg-white/22" : "bg-white/10"
                      }`}
                    />
                    <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">
                      {iteration.id === activeIterationId ? "active" : "select"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
      </aside>

      {isRunProgressMounted ? (
        <div
          aria-label="Run Progress"
          className={`absolute right-5 top-5 z-30 w-[320px] origin-top-right transform-gpu rounded-lg border border-white/14 bg-black/95 shadow-2xl shadow-black/40 will-change-transform transition-[transform,opacity] duration-100 ease-out ${
            isRunProgressVisible
              ? "translate-y-0 scale-100 opacity-100"
              : "-translate-y-1 scale-[0.99] opacity-0"
          }`}
        >
          <div className="flex h-12 items-center justify-between border-b border-white/10 px-4">
            <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.16em] text-white/70">
              <Activity className="size-4" />
              Run Progress
            </div>
            <button
              type="button"
              onClick={closeRunProgress}
              aria-label="Close run progress"
              className="inline-flex size-8 items-center justify-center rounded-md text-white/60 outline-none transition hover:bg-white/8 hover:text-white focus-visible:ring-2 focus-visible:ring-white/35"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="space-y-3 px-4 py-4">
            {["Input queued", "Ingest processed", "Router dispatched", "Parallel agents running", "Review pending", "Output waiting"].map(
              (step, index) => (
                <div key={step} className="flex items-center gap-3">
                  <div
                    className={`size-2 rounded-full ${
                      index < 3 ? "bg-white" : index === 3 ? "bg-white/55" : "bg-white/18"
                    }`}
                  />
                  <div className={index < 4 ? "text-sm text-white/78" : "text-sm text-white/36"}>
                    {step}
                  </div>
                </div>
              ),
            )}
          </div>
        </div>
      ) : null}

      <svg
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        role="img"
        aria-label="Monochrome top-down procedural pipeline graph of interconnected agent nodes"
        className={`absolute inset-0 h-full w-full touch-none px-3 py-4 ${
          isPanning ? "cursor-grabbing" : "cursor-grab"
        }`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      >
        <defs>
          <pattern id="major-grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M 48 0 H 0 V 48" fill="none" stroke="white" strokeOpacity=".055" />
          </pattern>
          <pattern id="minor-grid" width="12" height="12" patternUnits="userSpaceOnUse">
            <path d="M 12 0 H 0 V 12" fill="none" stroke="white" strokeOpacity=".025" />
          </pattern>
          <radialGradient id="grid-mask" cx="50%" cy="50%" r="62%">
            <stop offset="0%" stopColor="white" stopOpacity="1" />
            <stop offset="72%" stopColor="white" stopOpacity=".8" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </radialGradient>
          <mask id="grid-fade">
            <rect
              x={viewBox.x - viewBox.width}
              y={viewBox.y - viewBox.height}
              width={viewBox.width * 3}
              height={viewBox.height * 3}
              fill="url(#grid-mask)"
            />
          </mask>
          <pattern
            id="input-texture"
            width="12"
            height="12"
            patternUnits="userSpaceOnUse"
          >
            <path d="M 12 0 L 0 12" stroke="white" strokeOpacity=".08" strokeWidth=".8" />
          </pattern>
          <marker
            id="arrow"
            markerHeight="9"
            markerWidth="9"
            orient="auto"
            refX="8"
            refY="4.5"
            viewBox="0 0 9 9"
          >
            <path d="M 0 0 L 9 4.5 L 0 9 z" fill="white" fillOpacity=".72" />
          </marker>
          <marker
            id="arrow-muted"
            markerHeight="8"
            markerWidth="8"
            orient="auto"
            refX="7"
            refY="4"
            viewBox="0 0 8 8"
          >
            <path d="M 0 0 L 8 4 L 0 8 z" fill="white" fillOpacity=".3" />
          </marker>
        </defs>
        <g mask="url(#grid-fade)">
          <rect
            x={viewBox.x - viewBox.width}
            y={viewBox.y - viewBox.height}
            width={viewBox.width * 3}
            height={viewBox.height * 3}
            fill="url(#major-grid)"
          />
          <rect
            x={viewBox.x - viewBox.width}
            y={viewBox.y - viewBox.height}
            width={viewBox.width * 3}
            height={viewBox.height * 3}
            fill="url(#minor-grid)"
            opacity=".6"
          />
        </g>
        <g>
          {edges.map((edge) => {
            const from = getNode(edge.from);
            const to = getNode(edge.to);
            const start = edgePoint(from, to);
            const end = edgePoint(to, from);

            return (
              <path
                key={`${edge.from}-${edge.to}`}
                d={connectorPath(start, end)}
                fill="none"
                stroke="white"
                strokeOpacity={edge.primary ? ".48" : ".22"}
                strokeWidth={edge.primary ? "1.35" : "1"}
                strokeLinecap="round"
                markerEnd={edge.primary ? "url(#arrow)" : "url(#arrow-muted)"}
              />
            );
          })}
        </g>

        <g>
          {nodes.map((node) => (
            <g key={node.id}>
              <rect
                x={node.x - node.width / 2}
                y={node.y - node.height / 2}
                width={node.width}
                height={node.height}
                rx={node.terminal ? "28" : "6"}
                fill={node.id === "input" ? "#0d0d0d" : node.terminal ? "#101010" : "#050505"}
                stroke="white"
                strokeOpacity={node.id === "input" ? ".96" : node.terminal ? ".72" : ".5"}
                strokeWidth={node.id === "input" ? "1.6" : node.terminal ? "1.25" : "1"}
              />
              {node.id === "input" ? (
                <>
                  <rect
                    x={node.x - node.width / 2 + 10}
                    y={node.y - node.height / 2 + 10}
                    width={node.width - 20}
                    height={node.height - 20}
                    rx="22"
                    fill="url(#input-texture)"
                  />
                  <rect
                    x={node.x - node.width / 2 + 14}
                    y={node.y - node.height / 2 + 14}
                    width={node.width - 28}
                    height={node.height - 28}
                    rx="19"
                    fill="none"
                    stroke="white"
                    strokeOpacity=".16"
                    strokeWidth=".9"
                  />
                </>
              ) : null}
              <line
                x1={node.x - node.width / 2 + 20}
                y1={node.y + 5}
                x2={node.x + node.width / 2 - 20}
                y2={node.y + 5}
                stroke="white"
                strokeOpacity={node.id === "input" ? ".24" : ".16"}
              />
              <text
                x={node.x}
                y={node.y - 8}
                textAnchor="middle"
                className={
                  node.id === "input"
                    ? "fill-white font-sans text-[20px] font-semibold"
                    : node.terminal
                    ? "fill-white font-sans text-[18px] font-semibold"
                    : "fill-white font-sans text-[17px] font-medium"
                }
              >
                {node.model}
              </text>
              <text
                x={node.x}
                y={node.y + 26}
                textAnchor="middle"
                className={
                  node.id === "input"
                    ? "fill-white/58 font-mono text-[10px]"
                    : "fill-white/48 font-mono text-[10px]"
                }
              >
                {node.description}
              </text>
            </g>
          ))}
        </g>

        <g>
          {edges
            .filter((edge) => edge.primary)
            .map((edge) => {
              const node = getNode(edge.to);
              const beginTime = edgeBegin(edge);
              const holdStart = (beginTime + edgeTravelSeconds) / flowCycleSeconds;
              const holdVisible = (beginTime + edgeTravelSeconds + 0.12) / flowCycleSeconds;
              const holdEnd =
                (beginTime + edgeTravelSeconds + nodeProcessingSeconds) / flowCycleSeconds;

              return (
                <rect
                  key={`processing-${edge.from}-${edge.to}`}
                  x={node.x - node.width / 2 - 4}
                  y={node.y - node.height / 2 - 4}
                  width={node.width + 8}
                  height={node.height + 8}
                  rx={node.terminal ? "31" : "9"}
                  fill="none"
                  stroke="white"
                  strokeOpacity="0"
                  strokeWidth="1"
                >
                  <animate
                    attributeName="stroke-opacity"
                    values="0;0;0.92;0.92;0"
                    keyTimes={`0;${holdStart};${holdVisible};${holdEnd};1`}
                    dur={`${flowCycleSeconds}s`}
                    begin="0s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="stroke-width"
                    values="1;1;3;3;1"
                    keyTimes={`0;${holdStart};${holdVisible};${holdEnd};1`}
                    dur={`${flowCycleSeconds}s`}
                    begin="0s"
                    repeatCount="indefinite"
                  />
                </rect>
              );
            })}
        </g>

        <g>
          {edges
            .filter((edge) => edge.primary)
            .map((edge) => {
              const from = getNode(edge.from);
              const to = getNode(edge.to);
              const start = edgePoint(from, to);
              const end = edgePoint(to, from);
              const beginTime = edgeBegin(edge);
              const moveStart = beginTime / flowCycleSeconds;
              const moveEnd = (beginTime + edgeTravelSeconds) / flowCycleSeconds;
              const holdEnd =
                (beginTime + edgeTravelSeconds + nodeProcessingSeconds) / flowCycleSeconds;

              return (
                <circle key={`flow-${edge.from}-${edge.to}`} r="3.4" fill="white" opacity=".82">
                  <animateMotion
                    dur={`${flowCycleSeconds}s`}
                    begin="0s"
                    path={connectorPath(start, end)}
                    keyPoints={`0;0;1;1;1`}
                    keyTimes={`0;${moveStart};${moveEnd};${holdEnd};1`}
                    calcMode="linear"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity"
                    values="0;0;.9;.9;0;0"
                    keyTimes={`0;${moveStart};${moveStart + 0.015};${holdEnd};${Math.min(
                      holdEnd + 0.04,
                      0.98,
                    )};1`}
                    dur={`${flowCycleSeconds}s`}
                    begin="0s"
                    repeatCount="indefinite"
                  />
                </circle>
              );
            })}
        </g>
      </svg>
    </main>
  );
}
