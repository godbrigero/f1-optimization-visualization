"use client";

import { Boxes, Flag, Gauge, Route, TimerReset } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const stages = [
  {
    label: "Strategy layer",
    title: "Translate a prompt into a strategy brief",
    copy: "Bron starts with the driver's spoken goal and uploaded data, then turns that rough input into a structured optimization brief the agents can act on.",
    metric: "24 rounds",
    detail: "converted into a season strategy brief",
    accent: "text-red-300",
  },
  {
    label: "Constraint model",
    title: "Distance is only the first variable",
    copy: "Each transfer can account for flight speed, date spacing, airport reach, and the recovery window needed before freight, teams, and crews move again.",
    metric: "5 inputs",
    detail: "distance, speed, dates, buffers, geography",
    accent: "text-amber-200",
  },
  {
    label: "Optimization pass",
    title: "Compare the season against cleaner paths",
    copy: "The agent pipeline can reorder candidate legs, test regional clusters, and surface the tradeoff between fewer miles and the fixed reality of a global championship.",
    metric: "global",
    detail: "search across route permutations",
    accent: "text-emerald-300",
  },
  {
    label: "Decision output",
    title: "Turn the route into a clear recommendation",
    copy: "The final story should show what changed, what it saved, and which calendar compromises made the biggest difference.",
    metric: "clear delta",
    detail: "before and after strategy evidence",
    accent: "text-sky-200",
  },
];

function clamp(value: number) {
  return Math.min(Math.max(value, 0), 1);
}

export function StrategyScrollStory() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [pinState, setPinState] = useState<"before" | "pinned" | "after">("before");

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const updateProgress = () => {
      frameRef.current = null;
      const rect = section.getBoundingClientRect();
      const scrollable = rect.height - window.innerHeight;
      const nextProgress = scrollable > 0 ? clamp(-rect.top / scrollable) : 0;
      setProgress(nextProgress);
      setPinState(rect.top > 0 ? "before" : rect.bottom < window.innerHeight ? "after" : "pinned");
    };

    const requestUpdate = () => {
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(updateProgress);
    };

    updateProgress();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);

    return () => {
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  const activeStage = useMemo(
    () => Math.min(stages.length - 1, Math.floor(progress * stages.length)),
    [progress],
  );
  const routeDraw = 980 - progress * 980;
  const ghostCarX = 88 + progress * 674;
  const ghostCarY = 285 - Math.sin(progress * Math.PI) * 145;
  const telemetryLift = progress * -34;

  return (
    <section
      ref={sectionRef}
      className="relative min-h-[380svh] bg-[#0b0d10] text-white"
      aria-label="F1 logistics strategy"
    >
      <div
        className={`z-20 left-0 right-0 flex h-svh items-center overflow-hidden ${
          pinState === "pinned" ? "fixed top-0" : pinState === "after" ? "absolute bottom-0" : "absolute top-0"
        }`}
      >
        <div className="absolute inset-0 bg-[linear-gradient(110deg,rgba(255,40,40,0.16),transparent_32%,rgba(54,211,153,0.12)_68%,transparent)]" />
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/80 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#0b0d10] to-transparent" />

        <div className="relative z-10 mx-auto grid w-full max-w-7xl grid-cols-1 gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:px-8">
          <div className="max-w-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-red-300/80">
              Scroll strategy board
            </p>
            <h2 className="mt-4 text-4xl font-semibold leading-[0.96] text-white sm:text-6xl lg:text-7xl">
              The season becomes a routing model.
            </h2>
            <p className="mt-5 max-w-lg text-base leading-7 text-white/68 sm:text-lg">
              Under the Bron intake, the project explains how an F1 calendar can be evaluated like a
              logistics system: capture intent, define constraints, test alternatives, and make the
              tradeoffs visible.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {stages.map((stage, index) => {
                const isActive = index === activeStage;

                return (
                  <div
                    key={stage.label}
                    className={`rounded-lg border p-4 transition duration-300 ${
                      isActive
                        ? "border-white/30 bg-white/[0.09] shadow-[0_16px_50px_rgba(0,0,0,0.35)]"
                        : "border-white/10 bg-white/[0.035]"
                    }`}
                  >
                    <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${stage.accent}`}>
                      {stage.label}
                    </p>
                    <p className="mt-2 text-2xl font-semibold tabular-nums text-white">{stage.metric}</p>
                    <p className="mt-1 text-sm leading-5 text-white/58">{stage.detail}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="relative min-h-[34rem] overflow-hidden rounded-lg border border-white/12 bg-[#11161b]/88 shadow-2xl shadow-black/45 backdrop-blur">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-5">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-md bg-red-500/15 text-red-200">
                  <Flag className="size-4" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">Optimization run</p>
                  <p className="text-xs text-white/45">Calendar logistics model</p>
                </div>
              </div>
              <div className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1 text-xs font-medium text-emerald-200">
                {Math.round(progress * 100)}%
              </div>
            </div>

            <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="relative min-h-[20rem] overflow-hidden rounded-md border border-white/10 bg-black/35">
                <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:34px_34px]" />
                <svg
                  viewBox="0 0 850 380"
                  className="absolute inset-0 h-full w-full"
                  role="img"
                  aria-label="Animated strategy route line"
                >
                  <path
                    d="M88 285 C178 205 238 331 331 238 S492 100 580 166 680 295 762 111"
                    fill="none"
                    stroke="rgba(255,255,255,0.14)"
                    strokeWidth="7"
                    strokeLinecap="round"
                  />
                  <path
                    d="M88 285 C178 205 238 331 331 238 S492 100 580 166 680 295 762 111"
                    fill="none"
                    stroke="url(#strategy-line)"
                    strokeDasharray="980"
                    strokeDashoffset={routeDraw}
                    strokeWidth="7"
                    strokeLinecap="round"
                  />
                  <defs>
                    <linearGradient id="strategy-line" x1="0" x2="1" y1="0" y2="0">
                      <stop offset="0%" stopColor="#ff2b2b" />
                      <stop offset="52%" stopColor="#facc15" />
                      <stop offset="100%" stopColor="#34d399" />
                    </linearGradient>
                  </defs>
                  {[
                    [88, 285],
                    [331, 238],
                    [580, 166],
                    [762, 111],
                  ].map(([cx, cy], index) => (
                    <g key={`${cx}-${cy}`}>
                      <circle cx={cx} cy={cy} r="15" fill="rgba(255,255,255,0.1)" />
                      <circle
                        cx={cx}
                        cy={cy}
                        r="5"
                        fill={index <= activeStage ? "#ffffff" : "rgba(255,255,255,0.35)"}
                      />
                    </g>
                  ))}
                  <g transform={`translate(${ghostCarX} ${ghostCarY})`}>
                    <rect
                      x="-22"
                      y="-10"
                      width="44"
                      height="20"
                      rx="5"
                      fill="#f3f4f6"
                      opacity="0.95"
                    />
                    <rect x="-12" y="-16" width="24" height="10" rx="3" fill="#ef4444" />
                    <circle cx="-13" cy="13" r="5" fill="#0b0d10" />
                    <circle cx="13" cy="13" r="5" fill="#0b0d10" />
                  </g>
                </svg>

                <div className="absolute bottom-4 left-4 right-4 grid grid-cols-3 gap-2">
                  {["baseline", "regional", "optimized"].map((item, index) => (
                    <div key={item} className="rounded-md border border-white/10 bg-black/45 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.16em] text-white/40">{item}</p>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-red-400 transition-[width] duration-300"
                          style={{ width: `${Math.max(14, progress * 86 - index * 14)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex min-h-[20rem] flex-col justify-between gap-4">
                <div className="rounded-md border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-center gap-3 text-white/55">
                    <Route className="size-4 text-red-300" aria-hidden="true" />
                    <p className="text-xs font-semibold uppercase tracking-[0.18em]">
                      {stages[activeStage].label}
                    </p>
                  </div>
                  <h3 className="mt-4 text-2xl font-semibold leading-tight text-white">
                    {stages[activeStage].title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-white/65">{stages[activeStage].copy}</p>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {[
                    { icon: Gauge, label: "speed", value: "tunable" },
                    { icon: TimerReset, label: "buffer", value: "date gap" },
                    { icon: Boxes, label: "freight", value: "leg cost" },
                  ].map(({ icon: Icon, label, value }, index) => (
                    <div key={label} className="rounded-md border border-white/10 bg-black/30 p-3">
                      <Icon className="size-4 text-white/55" aria-hidden="true" />
                      <p className="mt-3 text-[10px] uppercase tracking-[0.16em] text-white/38">{label}</p>
                      <p className="mt-1 text-sm font-medium text-white/85">{value}</p>
                      <div className="mt-3 h-14 overflow-hidden">
                        <div
                          className="flex flex-col gap-1 transition-transform duration-300"
                          style={{ transform: `translateY(${telemetryLift + index * -7}px)` }}
                        >
                          {Array.from({ length: 8 }).map((_, barIndex) => (
                            <div
                              key={barIndex}
                              className="h-1.5 rounded-full bg-white/12"
                              style={{
                                width: `${35 + ((barIndex * 17 + index * 19) % 58)}%`,
                                opacity: 0.42 + barIndex * 0.055,
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
