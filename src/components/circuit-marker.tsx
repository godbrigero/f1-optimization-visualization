import { cn } from "@/lib/utils";

type CircuitMarkerProps = {
  name: string;
  x: number;
  y: number;
  index: number;
};

export function CircuitMarker({
  name,
  x,
  y,
  index,
}: CircuitMarkerProps) {
  return (
    <div
      aria-label={name}
      className={cn(
        "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2",
        "size-2"
      )}
      role="img"
      style={{
        left: `${x}%`,
        top: `${y}%`,
        zIndex: 20 + index,
      }}
      title={name}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-full border border-slate-950/80 bg-slate-100"
      />
    </div>
  );
}
