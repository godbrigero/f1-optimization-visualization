"use client";

import Image from "next/image";
import { PlaneTakeoff, RotateCcw } from "lucide-react";
import { useState } from "react";

import { AirplaneFlight } from "@/components/airplane-flight";
import { CircuitMarker } from "@/components/circuit-marker";
import { Button } from "@/components/ui/button";
import { VoiceTranscriptionButton } from "@/components/voice-transcription-button";
import { circuits } from "@/lib/f1-circuits";

export function FlightMap() {
  const [flightRun, setFlightRun] = useState(0);
  const raceRoute = circuits.map((circuit) => ({
    circuit,
    point: circuit.mapPosition,
  }));
  const raceLegs = raceRoute.slice(0, -1).map((stop, index) => ({
    from: stop,
    to: raceRoute[index + 1],
  }));

  return (
    <main className="fixed inset-0 overflow-hidden bg-[linear-gradient(145deg,oklch(0.105_0.015_255),oklch(0.075_0.012_245)_46%,oklch(0.055_0.01_230))]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_48%_44%,oklch(0.19_0.028_205_/_0.42),transparent_52%),radial-gradient(ellipse_at_70%_18%,oklch(0.18_0.035_168_/_0.16),transparent_34%)]" />
      <Image
        src="/world-map-robinson.svg"
        alt="World map in Robinson projection"
        fill
        priority
        unoptimized
        sizes="100vw"
        className="object-fill opacity-[0.22] invert grayscale contrast-150 brightness-75"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_0,oklch(0.78_0.035_210_/_0.045)_1px,transparent_1px),linear-gradient(0deg,transparent_0,oklch(0.78_0.035_210_/_0.032)_1px,transparent_1px)] bg-[size:14vw_14vw] opacity-35 [mask-image:radial-gradient(ellipse_at_center,black_0%,transparent_76%)]" />
      <div className="absolute inset-0 bg-[repeating-linear-gradient(0deg,oklch(1_0_0_/_0.018)_0,oklch(1_0_0_/_0.018)_1px,transparent_1px,transparent_5px)] opacity-20 mix-blend-soft-light" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,oklch(0_0_0_/_0.28),transparent_24%,transparent_68%,oklch(0_0_0_/_0.42))]" />
      <div className="absolute inset-0 shadow-[inset_0_0_180px_oklch(0_0_0_/_0.82)]" />

      <div className="absolute inset-0" aria-label="Formula 1 circuit locations">
        {raceRoute.map(({ circuit, point }, index) => (
          <CircuitMarker
            key={circuit.key}
            name={`${circuit.name}, ${circuit.city}`}
            x={point.x}
            y={point.y}
            index={index}
          />
        ))}
      </div>

      <div className="absolute inset-0 z-30" aria-label="Formula 1 calendar flight legs">
        {raceLegs.map((leg, index) => (
          <AirplaneFlight
            key={`${leg.from.circuit.key}-${leg.to.circuit.key}`}
            startTrigger={flightRun}
            startX={leg.from.point.x}
            startY={leg.from.point.y}
            endX={leg.to.point.x}
            endY={leg.to.point.y}
            durationMs={4200}
            delayMs={index * 95}
            curveBend={index % 2 === 0 ? -9 : 9}
            size={24}
            idleVisible={false}
            className="z-30"
            pathLabel={`${leg.from.circuit.city} to ${leg.to.circuit.city}`}
          />
        ))}
      </div>

      <div className="absolute left-4 top-4 z-40 rounded-lg border border-white/15 bg-black/65 p-1.5 shadow-lg shadow-black/30 backdrop-blur-sm">
        <Button onClick={() => setFlightRun((run) => run + 1)}>
          {flightRun === 0 ? (
            <PlaneTakeoff data-icon="inline-start" />
          ) : (
            <RotateCcw data-icon="inline-start" />
          )}
          {flightRun === 0 ? "Start flight" : "Replay flight"}
        </Button>
      </div>

      <div className="absolute right-4 top-4 z-40 max-w-[calc(100vw-2rem)]">
        <VoiceTranscriptionButton />
      </div>
    </main>
  );
}
