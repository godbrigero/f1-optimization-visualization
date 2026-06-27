"use client";

import { GitBranch, PanelLeft, Plus, X } from "lucide-react";
import { useState } from "react";

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

const nodes: AgentNode[] = [
  {
    id: "input",
    model: "Input",
    description: "request + source data",
    terminal: true,
    x: 600,
    y: 70,
    width: 250,
    height: 76,
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
  { from: "planner", to: "reasoner", primary: true },
  { from: "planner", to: "review", primary: true },
  { from: "reasoner", to: "review", primary: true },
  { from: "tools", to: "review", primary: true },
  { from: "review", to: "output", primary: true },
  { from: "planner", to: "tools" },
  { from: "tools", to: "reasoner" },
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
  planner --> reasoner
  planner --> review
  reasoner --> review
  tools --> review
  review --> output
  planner -.-> tools
  tools -.-> reasoner

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

export function AgentGraph() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [iterations, setIterations] = useState<Iteration[]>([
    {
      id: 1,
      name: "Iteration 1",
      description: "Six-node procedural pipeline",
      mermaid: mermaidGraph,
    },
  ]);
  const [activeIterationId, setActiveIterationId] = useState(1);

  const activeIteration =
    iterations.find((iteration) => iteration.id === activeIterationId) ?? iterations[0];

  function addIteration() {
    const nextId = Math.max(...iterations.map((iteration) => iteration.id)) + 1;
    const nextIteration = {
      id: nextId,
      name: `Iteration ${nextId}`,
      description: "New graph draft",
      mermaid: activeIteration.mermaid,
    };

    setIterations((currentIterations) => [...currentIterations, nextIteration]);
    setActiveIterationId(nextId);
    setIsSidebarOpen(true);
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <h1 className="sr-only">Interconnected agent node graph</h1>

      <button
        type="button"
        aria-label="Open iterations"
        onClick={() => setIsSidebarOpen(true)}
        className="absolute left-5 top-5 z-20 inline-flex h-9 items-center gap-2 rounded-md border border-white/14 bg-black/80 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-white/72 outline-none transition hover:border-white/28 hover:text-white focus-visible:ring-2 focus-visible:ring-white/35"
      >
        <PanelLeft className="size-4" />
        Iterations
      </button>

      <button
        type="button"
        onClick={addIteration}
        className="absolute right-5 top-5 z-20 inline-flex h-9 items-center gap-2 rounded-md border border-white/14 bg-black/80 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-white/72 outline-none transition hover:border-white/28 hover:text-white focus-visible:ring-2 focus-visible:ring-white/35"
      >
        <Plus className="size-4" />
        Add graph
      </button>

      {isSidebarOpen ? (
        <>
          <aside
            aria-label="Iterations"
            className="absolute inset-y-0 left-0 z-30 w-[320px] border-r border-white/12 bg-black/95"
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

            <div className="space-y-2 p-3">
              <button
                type="button"
                onClick={addIteration}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-white/14 bg-white/[0.03] font-mono text-[11px] uppercase tracking-[0.14em] text-white/72 outline-none transition hover:border-white/30 hover:text-white focus-visible:ring-2 focus-visible:ring-white/35"
              >
                <Plus className="size-4" />
                New graph
              </button>

              {iterations.map((iteration) => (
                <button
                  key={iteration.id}
                  type="button"
                  onClick={() => setActiveIterationId(iteration.id)}
                  className={`w-full rounded-md border p-3 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-white/35 ${
                    iteration.id === activeIterationId
                      ? "border-white/45 bg-white/[0.08]"
                      : "border-white/10 bg-white/[0.025] hover:border-white/22"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-white">{iteration.name}</div>
                    <div className="font-mono text-[10px] text-white/40">v{iteration.id}</div>
                  </div>
                  <div className="mt-1 text-xs text-white/45">{iteration.description}</div>
                  <div className="mt-3 truncate font-mono text-[10px] text-white/28">
                    {iteration.mermaid.split("\n")[0]}
                  </div>
                </button>
              ))}
            </div>
          </aside>
          <button
            type="button"
            aria-label="Close iterations overlay"
            onClick={() => setIsSidebarOpen(false)}
            className="absolute inset-0 z-20 bg-black/35"
          />
        </>
      ) : null}

      <svg
        viewBox="160 20 880 780"
        role="img"
        aria-label="Monochrome top-down procedural pipeline graph of interconnected agent nodes"
        className="absolute inset-0 h-full w-full px-3 py-4"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
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
                fill={node.terminal ? "#101010" : "#050505"}
                stroke="white"
                strokeOpacity={node.terminal ? ".72" : ".5"}
                strokeWidth={node.terminal ? "1.25" : "1"}
              />
              <text
                x={node.x + node.width / 2 - 16}
                y={node.y - node.height / 2 + 18}
                textAnchor="end"
                className="fill-white/32 font-mono text-[7px] uppercase tracking-[0.18em]"
              >
                {node.terminal ? "terminal" : "model"}
              </text>
              <line
                x1={node.x - node.width / 2 + 20}
                y1={node.y + 5}
                x2={node.x + node.width / 2 - 20}
                y2={node.y + 5}
                stroke="white"
                strokeOpacity=".16"
              />
              <text
                x={node.x}
                y={node.y - 8}
                textAnchor="middle"
                className={
                  node.terminal
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
                className="fill-white/48 font-mono text-[10px]"
              >
                {node.description}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </main>
  );
}
