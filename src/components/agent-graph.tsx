"use client";

import { Activity, Boxes, GitBranch, PanelLeft, RotateCcw, X } from "lucide-react";
import {
  type PointerEvent,
  type WheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import {
  type GenomeEdge,
  type GenomeNode,
  type RunDriver,
  type RunEvent,
  applyRunEvent,
  createSimulatedRun,
  createSocketRun,
  displayedGenome,
  initialRunState,
} from "@/lib/agent-run";

type LaidNode = GenomeNode & {
  x: number;
  y: number;
  width: number;
  height: number;
  entry: boolean;
};

type GraphViewBox = {
  height: number;
  width: number;
  x: number;
  y: number;
};

const centerX = 600;
const topY = 80;
const rowGap = 132;
const colGap = 300;
const terminalWidth = 280;
const nodeWidth = 244;
const terminalHeight = 96;
const nodeHeight = 78;

function isPrimaryEdge(edge: GenomeEdge) {
  return edge.primary !== false;
}

// Longest-path rank from the entry nodes, so any pushed topology can be laid
// out top-to-bottom without hardcoded coordinates.
function computeRanks(nodes: GenomeNode[], edges: GenomeEdge[]) {
  const incoming = new Map<string, string[]>();
  nodes.forEach((node) => incoming.set(node.id, []));
  edges.forEach((edge) => {
    incoming.get(edge.to)?.push(edge.from);
  });

  const rank = new Map<string, number>();

  function rankOf(id: string, seen: Set<string>): number {
    const cached = rank.get(id);
    if (cached !== undefined) {
      return cached;
    }
    if (seen.has(id)) {
      return 0;
    }
    seen.add(id);

    let value = 0;
    for (const from of incoming.get(id) ?? []) {
      value = Math.max(value, rankOf(from, seen) + 1);
    }

    rank.set(id, value);
    return value;
  }

  nodes.forEach((node) => rankOf(node.id, new Set<string>()));
  return rank;
}

function layoutGenome(nodes: GenomeNode[], edges: GenomeEdge[]) {
  const rank = computeRanks(nodes, edges);
  const byRank = new Map<number, GenomeNode[]>();

  nodes.forEach((node) => {
    const value = rank.get(node.id) ?? 0;
    const group = byRank.get(value);
    if (group) {
      group.push(node);
    } else {
      byRank.set(value, [node]);
    }
  });

  const laidNodes: LaidNode[] = [];

  byRank.forEach((group, value) => {
    group.forEach((node, index) => {
      const offset = index - (group.length - 1) / 2;
      laidNodes.push({
        ...node,
        x: centerX + offset * colGap,
        y: topY + value * rowGap,
        width: node.terminal ? terminalWidth : nodeWidth,
        height: node.terminal ? terminalHeight : nodeHeight,
        entry: Boolean(node.terminal) && value === 0,
      });
    });
  });

  const maxRank = Math.max(0, ...laidNodes.map((node) => rank.get(node.id) ?? 0));

  return { laidNodes, rank, maxRank };
}

function edgePoint(from: LaidNode, to: LaidNode) {
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

const rankStepSeconds = 1.4;
const edgeTravelSeconds = 0.85;
const nodeProcessingSeconds = 0.55;

const initialViewBox: GraphViewBox = {
  x: 160,
  y: 20,
  width: 880,
  height: 780,
};

const minZoomWidth = 520;
const maxZoomWidth = 1400;

function formatFitness(fitness: number) {
  return `${Math.round(fitness * 100)}%`;
}

function isDefaultViewBox(viewBox: GraphViewBox) {
  return (
    Math.abs(viewBox.x - initialViewBox.x) < 0.5 &&
    Math.abs(viewBox.y - initialViewBox.y) < 0.5 &&
    Math.abs(viewBox.width - initialViewBox.width) < 0.5 &&
    Math.abs(viewBox.height - initialViewBox.height) < 0.5
  );
}

function createDriver(): RunDriver {
  const socketUrl = process.env.NEXT_PUBLIC_AGENT_RUN_WS;
  // Swap point: set NEXT_PUBLIC_AGENT_RUN_WS to the Python brain's WebSocket to
  // drive the page from the real backend instead of the scripted simulation.
  return socketUrl ? createSocketRun(socketUrl) : createSimulatedRun();
}

export function AgentGraph() {
  const [runState, dispatch] = useReducer(applyRunEvent, initialRunState);
  const emit = useCallback((event: RunEvent) => dispatch(event), []);
  const driverRef = useRef<RunDriver | null>(null);

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isRunProgressMounted, setIsRunProgressMounted] = useState(false);
  const [isRunProgressVisible, setIsRunProgressVisible] = useState(false);
  const [manualSelection, setManualSelection] = useState<number | null>(null);
  const [conversationSummary] = useState(() => {
    if (typeof window === "undefined") {
      return "";
    }

    return window.sessionStorage.getItem("f1-agent-conversation-summary") ?? "";
  });
  const [viewBox, setViewBox] = useState<GraphViewBox>(initialViewBox);
  const [isPanning, setIsPanning] = useState(false);
  const lastPointerPosition = useRef<{ x: number; y: number } | null>(null);
  const viewBoxRef = useRef<GraphViewBox>(initialViewBox);
  const zoomAnimationFrame = useRef<number | null>(null);
  const runProgressAnimationFrame = useRef<number | null>(null);
  const runProgressCloseTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Start the run (simulation, or the real backend if the env URL is set), and
  // allow manual/backend injection through a window hook + custom event.
  useEffect(() => {
    const driver = createDriver();
    driverRef.current = driver;
    driver.start(emit);

    function handleInjectedEvent(event: Event) {
      const customEvent = event as CustomEvent<RunEvent>;
      if (customEvent.detail) {
        emit(customEvent.detail);
      }
    }

    const runWindow = window as Window & { f1AgentRun?: { emit: (event: RunEvent) => void } };
    runWindow.f1AgentRun = { emit };
    window.addEventListener("agent-run:event", handleInjectedEvent);

    return () => {
      driver.stop();
      delete runWindow.f1AgentRun;
      window.removeEventListener("agent-run:event", handleInjectedEvent);

      if (zoomAnimationFrame.current) {
        cancelAnimationFrame(zoomAnimationFrame.current);
      }
      if (runProgressAnimationFrame.current) {
        cancelAnimationFrame(runProgressAnimationFrame.current);
      }
      if (runProgressCloseTimeout.current) {
        clearTimeout(runProgressCloseTimeout.current);
      }
    };
  }, [emit]);

  useEffect(() => {
    viewBoxRef.current = viewBox;
  }, [viewBox]);

  function replayRun() {
    driverRef.current?.stop();
    setManualSelection(null);
    const driver = createSimulatedRun();
    driverRef.current = driver;
    driver.start(emit);
  }

  // The generation in view follows the run, unless the user manually picked one.
  const viewGenerationId = manualSelection ?? runState.activeGenerationId;
  const viewedGeneration =
    runState.generations.find((generation) => generation.id === viewGenerationId) ?? null;

  // What's actually on the graph right now: a live candidate if we're scoring
  // one, otherwise the generation the user is viewing.
  const { drawGenome, drawKey } = useMemo(() => {
    if (runState.candidate) {
      return {
        drawGenome: { nodes: runState.candidate.nodes, edges: runState.candidate.edges },
        drawKey: `candidate-${runState.candidate.label}`,
      };
    }
    if (viewedGeneration) {
      return {
        drawGenome: { nodes: viewedGeneration.nodes, edges: viewedGeneration.edges },
        drawKey: `gen-${viewedGeneration.id}`,
      };
    }
    const fallback = displayedGenome(runState);
    return {
      drawGenome: fallback,
      drawKey: "empty",
    };
  }, [runState, viewedGeneration]);

  const { laidNodes, rank, maxRank } = useMemo(
    () => layoutGenome(drawGenome?.nodes ?? [], drawGenome?.edges ?? []),
    [drawGenome],
  );

  const nodeMap = useMemo(() => {
    const map = new Map<string, LaidNode>();
    laidNodes.forEach((node) => map.set(node.id, node));
    return map;
  }, [laidNodes]);

  const drawEdges = drawGenome?.edges ?? [];

  const flowCycleSeconds =
    maxRank * rankStepSeconds + edgeTravelSeconds + nodeProcessingSeconds + 1.2;

  const edgeBeginFor = (edge: GenomeEdge) => (rank.get(edge.from) ?? 0) * rankStepSeconds;

  const fitnessBarPercent = Math.round((runState.bestFitness || 0) * 100);
  const thresholdPercent = Math.round(runState.threshold * 100);

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

      {/* Always-on run HUD: current phase + fitness vs. threshold. */}
      <section className="pointer-events-none absolute left-1/2 top-5 z-20 w-[min(560px,calc(100vw-2.5rem))] -translate-x-1/2 rounded-md border border-white/14 bg-black/82 px-4 py-3 shadow-[0_18px_50px_rgba(0,0,0,0.38)] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/38">
            {runState.status === "complete" ? "Converged" : "Evolving swarm"}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/38">
            best {formatFitness(runState.bestFitness)} · target {thresholdPercent}%
          </div>
        </div>
        <p className="mt-2 truncate text-sm leading-6 text-white/82">{runState.phase}</p>
        <div className="relative mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-white/80 transition-[width] duration-500 ease-out"
            style={{ width: `${fitnessBarPercent}%` }}
          />
          <div
            className="absolute top-0 h-full w-px bg-white/60"
            style={{ left: `${thresholdPercent}%` }}
          />
        </div>
        {runState.candidate ? (
          <div className="mt-2 font-mono text-[10px] text-white/50">
            evaluating {runState.candidate.label}
            {runState.candidate.fitness !== null
              ? ` — scored ${formatFitness(runState.candidate.fitness)}`
              : " — scoring…"}
          </div>
        ) : null}
      </section>

      {conversationSummary ? (
        <section className="pointer-events-none absolute bottom-5 left-1/2 z-20 w-[min(620px,calc(100vw-2.5rem))] -translate-x-1/2 rounded-md border border-white/12 bg-black/78 px-4 py-2.5 backdrop-blur-xl">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/34">
            Conversation summary
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/64">{conversationSummary}</p>
        </section>
      ) : null}

      <button
        type="button"
        aria-label="Open iterations"
        onClick={() => setIsSidebarOpen(true)}
        className={`absolute left-5 top-5 z-30 inline-flex h-9 items-center gap-2 rounded-md border border-white/14 bg-black/80 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-white/72 outline-none transition hover:border-white/28 hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 ${
          isSidebarOpen ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        <PanelLeft className="size-4" />
        Iterations
      </button>

      <div
        className={`absolute right-5 top-5 z-30 flex items-center gap-2 transition-opacity ${
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
          onClick={replayRun}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-white/14 bg-black/80 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-white/72 outline-none transition hover:border-white/28 hover:text-white focus-visible:ring-2 focus-visible:ring-white/35"
        >
          <RotateCcw className="size-4" />
          Replay
        </button>

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
        className={`absolute inset-y-0 left-0 z-40 flex w-[300px] flex-col border-r border-white/12 bg-black/92 transform-gpu will-change-transform transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isSidebarOpen
            ? "translate-x-0"
            : "pointer-events-none -translate-x-[calc(100%+1px)]"
        }`}
      >
          <div className="flex h-14 items-center justify-between border-b border-white/10 px-4">
            <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.16em] text-white/70">
              <GitBranch className="size-4" />
              Generations
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

          <div className="flex-1 overflow-y-auto px-4 py-3">
            <div className="space-y-2">
              {runState.generations.length === 0 ? (
                <div className="rounded-md border border-dashed border-white/12 px-3 py-4 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-white/30">
                  awaiting first generation
                </div>
              ) : null}
              {runState.generations.map((generation) => (
                <button
                  key={generation.id}
                  type="button"
                  onClick={() => setManualSelection(generation.id)}
                  className={`group w-full rounded-md border px-3 py-3 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-white/35 ${
                    generation.id === viewGenerationId
                      ? "border-white/44 bg-white/[0.075] text-white"
                      : "border-white/12 bg-black text-white/54 hover:border-white/28 hover:bg-white/[0.035] hover:text-white/80"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{generation.name}</div>
                      <div className="mt-1 truncate text-xs text-white/38">
                        {generation.description}
                      </div>
                    </div>
                    <div className="shrink-0 rounded-sm border border-white/12 px-1.5 py-0.5 font-mono text-[10px] text-white/36">
                      {formatFitness(generation.fitness)}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <span
                      className={`h-px flex-1 ${
                        generation.id === viewGenerationId ? "bg-white/22" : "bg-white/10"
                      }`}
                    />
                    <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">
                      {generation.id === viewGenerationId ? "active" : "select"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-white/10 px-4 py-3">
            <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/50">
              <Boxes className="size-3.5" />
              Corpus of agents · {runState.corpus.length}
            </div>
            <div className="space-y-1">
              {runState.corpus.map((agent) => (
                <div
                  key={agent.id}
                  className="flex items-center justify-between gap-2 rounded-sm border border-white/10 px-2 py-1.5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs text-white/72">{agent.id}</div>
                    <div className="truncate font-mono text-[9px] text-white/34">{agent.model}</div>
                  </div>
                  <span
                    className={`shrink-0 rounded-sm px-1 py-0.5 font-mono text-[8px] uppercase tracking-[0.12em] ${
                      agent.origin === "grown"
                        ? "border border-white/40 text-white/80"
                        : "border border-white/12 text-white/36"
                    }`}
                  >
                    {agent.origin}
                  </span>
                </div>
              ))}
            </div>
          </div>
      </aside>

      {isRunProgressMounted ? (
        <div
          aria-label="Run Progress"
          className={`absolute right-5 top-5 z-40 w-[340px] origin-top-right transform-gpu rounded-lg border border-white/14 bg-black/95 shadow-2xl shadow-black/40 will-change-transform transition-[transform,opacity] duration-100 ease-out ${
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

          <div className="border-b border-white/10 px-4 py-3">
            <div className="truncate text-sm text-white/72">{runState.phase}</div>
            <div className="mt-1 font-mono text-[11px] text-white/46">
              {runState.problemLabel || "—"}
            </div>
          </div>

          <div className="max-h-[280px] space-y-2.5 overflow-y-auto px-4 py-4">
            {runState.log.length === 0 ? (
              <div className="font-mono text-[11px] text-white/36">no activity yet</div>
            ) : null}
            {runState.log.map((entry) => (
              <div key={entry.id} className="flex items-start gap-3">
                <div
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${
                    entry.kind === "success"
                      ? "bg-white"
                      : entry.kind === "corpus"
                        ? "bg-white/70"
                        : entry.kind === "score"
                          ? "bg-white/55"
                          : "bg-white/30"
                  }`}
                />
                <div className="text-sm leading-5 text-white/74">{entry.text}</div>
              </div>
            ))}
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
          {drawEdges.map((edge) => {
            const from = nodeMap.get(edge.from);
            const to = nodeMap.get(edge.to);

            if (!from || !to) {
              return null;
            }

            const start = edgePoint(from, to);
            const end = edgePoint(to, from);
            const primary = isPrimaryEdge(edge);

            return (
              <path
                key={`${drawKey}-${edge.from}-${edge.to}`}
                d={connectorPath(start, end)}
                fill="none"
                stroke="white"
                strokeOpacity={primary ? ".48" : ".22"}
                strokeWidth={primary ? "1.35" : "1"}
                strokeLinecap="round"
                markerEnd={primary ? "url(#arrow)" : "url(#arrow-muted)"}
              />
            );
          })}
        </g>

        <g>
          {laidNodes.map((node, index) => (
            <g
              key={`${drawKey}-${node.id}`}
              className="agent-node-enter"
              style={{ animationDelay: `${index * 70}ms` }}
            >
              <rect
                x={node.x - node.width / 2}
                y={node.y - node.height / 2}
                width={node.width}
                height={node.height}
                rx={node.terminal ? "28" : "6"}
                fill={node.entry ? "#0d0d0d" : node.terminal ? "#101010" : "#050505"}
                stroke="white"
                strokeOpacity={node.entry ? ".96" : node.terminal ? ".72" : ".5"}
                strokeWidth={node.entry ? "1.6" : node.terminal ? "1.25" : "1"}
              />
              {node.entry ? (
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
                strokeOpacity={node.entry ? ".24" : ".16"}
              />
              <text
                x={node.x}
                y={node.y - 8}
                textAnchor="middle"
                className={
                  node.entry
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
                  node.entry
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
          {drawEdges
            .filter((edge) => isPrimaryEdge(edge))
            .map((edge) => {
              const node = nodeMap.get(edge.to);

              if (!node) {
                return null;
              }

              const beginTime = edgeBeginFor(edge);
              const holdStart = (beginTime + edgeTravelSeconds) / flowCycleSeconds;
              const holdVisible = (beginTime + edgeTravelSeconds + 0.12) / flowCycleSeconds;
              const holdEnd =
                (beginTime + edgeTravelSeconds + nodeProcessingSeconds) / flowCycleSeconds;

              return (
                <rect
                  key={`processing-${drawKey}-${edge.from}-${edge.to}`}
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
          {drawEdges
            .filter((edge) => isPrimaryEdge(edge))
            .map((edge) => {
              const from = nodeMap.get(edge.from);
              const to = nodeMap.get(edge.to);

              if (!from || !to) {
                return null;
              }

              const start = edgePoint(from, to);
              const end = edgePoint(to, from);
              const beginTime = edgeBeginFor(edge);
              const moveStart = beginTime / flowCycleSeconds;
              const moveEnd = (beginTime + edgeTravelSeconds) / flowCycleSeconds;
              const holdEnd =
                (beginTime + edgeTravelSeconds + nodeProcessingSeconds) / flowCycleSeconds;

              return (
                <circle key={`flow-${drawKey}-${edge.from}-${edge.to}`} r="3.4" fill="white" opacity=".82">
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
