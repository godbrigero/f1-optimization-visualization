"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter } from "next/navigation";
import { LogOut, Paperclip } from "lucide-react";
import {
  createAudioAnalyser,
  Room,
  RoomEvent,
  Track,
  type LocalAudioTrack,
  type RemoteParticipant,
  type RemoteTrackPublication,
  type RemoteAudioTrack,
  type RemoteTrack,
} from "livekit-client";
import {
  ATTACHED_DATASET_STORAGE_KEY,
  storeAttachedDataset,
  type AttachedDatasetWindow,
} from "@/lib/attached-dataset";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";

const TRANSCRIPTION_TOPIC = "lk.transcription";
const TRANSCRIPTION_FINAL_ATTRIBUTE = "lk.transcription_final";
const CUSTOM_DATASET_UPLOAD_TOPIC = "lebronsseiur.custom_dataset_upload";
const START_AGENT_WORK_TOPIC = "lebronsseiur.start_agent_work";
const VOICE_ROOM_PREFIX = "lebronsseiur-model-conversation";
const CONVERSATION_MESSAGES_STORAGE_KEY = "f1-agent-conversation-messages";
const START_AGENT_WORK_HANDOFF_DELAY_MS = 4200;
const ROUNDED_TRIANGLE_CLIP_PATH =
  "polygon(50% 1.5%, 53.5% 3.5%, 98% 88%, 96.5% 92%, 91% 94%, 9% 94%, 3.5% 92%, 2% 88%, 46.5% 3.5%)";
const ROUNDED_TRIANGLE_PATH =
  "M 50 4 Q 54 4 57 10 L 96 84 Q 100 92 90 92 L 10 92 Q 0 92 4 84 L 43 10 Q 46 4 50 4 Z";
const CROWN_PRIMARY_PATH =
  "M 24 62 L 28 38 L 41 52 L 50 31 L 59 52 L 72 38 L 76 62 Z";
const CROWN_BASE_PATH = "M 27 65 H 73 L 69 75 H 31 Z";
const CROWN_INNER_PATH =
  "M 32 60 L 36 49 M 45 59 L 50 45 M 55 59 L 64 49 M 34 68 H 66";

type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

function createIdentity() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `speaker-${crypto.randomUUID()}`;
  }

  return `speaker-${Date.now()}`;
}

function createVoiceRoomName(identity: string) {
  return `${VOICE_ROOM_PREFIX}-${identity}`;
}

function getRoleFromIdentity(identity: string): ConversationMessage["role"] {
  return identity.startsWith("speaker-") ? "user" : "assistant";
}

function getDisplaySpeaker(role: ConversationMessage["role"]) {
  return role === "user" ? "You" : "Agent";
}

function isConversationMessage(value: unknown): value is ConversationMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<ConversationMessage>;

  return (
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string" &&
    message.content.trim().length > 0
  );
}

function loadStoredConversationMessages() {
  if (typeof window === "undefined") {
    return [];
  }

  const storedMessages = window.sessionStorage.getItem(
    CONVERSATION_MESSAGES_STORAGE_KEY,
  );

  if (!storedMessages) {
    return [];
  }

  try {
    const parsedMessages = JSON.parse(storedMessages);

    return Array.isArray(parsedMessages)
      ? parsedMessages.filter(isConversationMessage)
      : [];
  } catch {
    return [];
  }
}

function storeConversationMessages(messages: ConversationMessage[]) {
  window.sessionStorage.setItem(
    CONVERSATION_MESSAGES_STORAGE_KEY,
    JSON.stringify(messages),
  );
}

function mentionsCustomDataset(text: string) {
  const normalizedText = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (normalizedText.length === 0) {
    return false;
  }

  const explicitCustomData =
    /\b(custom|my|our|own|uploaded|attached|local|external)\s+(data|dataset|file|spreadsheet|csv|excel|json|tsv)\b/.test(
      normalizedText,
    ) ||
    /\b(data|dataset|file|spreadsheet|csv|excel|json|tsv)\s+(of\s+my\s+own|from\s+me|from\s+my\s+side)\b/.test(
      normalizedText,
    );

  if (explicitCustomData) {
    return true;
  }

  const mentionsDataArtifact =
    /\b(dataset|data file|source data|spreadsheet|csv|xlsx|xls|excel|json|tsv)\b/.test(
      normalizedText,
    );
  const mentionsAttachAction =
    /\b(have|got|add|attach|upload|import|load|provide|send|use|using|include)\b/.test(
      normalizedText,
    );

  return mentionsDataArtifact && mentionsAttachAction;
}

const voiceGridSize = 11;
const voiceGridItems = Array.from(
  { length: voiceGridSize * voiceGridSize },
  (_, index) => index,
);
const ambientPixelColumns = 124;
const ambientPixelRows = 32;

type VoiceGridState = "connecting" | "listening";
type GridCoordinate = {
  x: number;
  y: number;
};
type SquarePointerEvent =
  | MouseEvent<HTMLElement>
  | ReactPointerEvent<HTMLElement>;

type AudioAnalyserHandle = ReturnType<typeof createAudioAnalyser>;

type AmbientPixel = {
  animationDelay: number;
  animationDuration: number;
  baseOpacity: number;
  brightOpacity: number;
  dimOpacity: number;
  isDimmed: boolean;
  isVisible: boolean;
  rotation: number;
};

function seededUnit(index: number, salt: number) {
  let value = Math.imul(index + 1, 374761393) ^ Math.imul(salt + 1, 668265263);
  value ^= value >>> 13;
  value = Math.imul(value, 1274126177);
  value ^= value >>> 16;

  return (value >>> 0) / 4294967295;
}

const ambientPixels: AmbientPixel[] = Array.from(
  { length: ambientPixelColumns * ambientPixelRows },
  (_, index) => {
    const column = index % ambientPixelColumns;
    const row = Math.floor(index / ambientPixelColumns);
    const centerX = (ambientPixelColumns - 1) / 2;
    const centerY = (ambientPixelRows - 1) / 2;
    const distanceX = Math.abs(column - centerX) / centerX;
    const distanceY = Math.abs(row - centerY) / centerY;
    const weightedDistance = Math.sqrt(
      distanceX ** 2 * 0.55 + distanceY ** 2 * 1.95,
    );
    const phase = Math.abs(seededUnit(index, 1));
    const brightness = Math.abs(seededUnit(index, 2));
    const cadence = Math.abs(seededUnit(index, 3));
    const presence = Math.abs(seededUnit(index, 4));
    const showChance = Math.max(
      0.012,
      (0.46 * Math.max(0, 1 - weightedDistance)) ** 1.18,
    );
    const isVisible = presence < showChance;
    const isDimmed = phase < 0.5;
    const baseOpacity = isDimmed
      ? 0.035 + brightness * 0.035
      : 0.105 + brightness * 0.075;
    const dimOpacity = isDimmed
      ? 0.018 + brightness * 0.018
      : 0.045 + brightness * 0.035;

    return {
      animationDelay: -phase * 7.2,
      animationDuration: 2.6 + cadence * 5.8,
      baseOpacity,
      brightOpacity: Math.min(0.58, baseOpacity + 0.18 + brightness * 0.18),
      dimOpacity,
      isDimmed,
      isVisible,
      rotation: Math.round(seededUnit(index, 5) * 360),
    };
  },
);

function isTriangleGridCoordinate(
  x: number,
  y: number,
  columnCount: number,
  rowCount: number,
) {
  const normalizedX = (x + 0.5) / columnCount;
  const normalizedY = (y + 0.5) / rowCount;

  return normalizedY >= Math.abs(normalizedX - 0.5) * 2;
}

function getTriangleRowColumns(
  row: number,
  columnCount: number,
  rowCount: number,
) {
  return Array.from({ length: columnCount }, (_, column) => column).filter(
    (column) => isTriangleGridCoordinate(column, row, columnCount, rowCount),
  );
}

function createTriangleRowsPath(columnCount: number, rowCount: number) {
  const path: GridCoordinate[] = [];

  for (let row = 0; row < rowCount; row += 1) {
    const rowCoordinates = getTriangleRowColumns(
      row,
      columnCount,
      rowCount,
    ).map((column) => ({ x: column, y: row }));

    path.push(...(row % 2 === 0 ? rowCoordinates : rowCoordinates.reverse()));
  }

  return path;
}

function createTrianglePerimeterPath(columnCount: number, rowCount: number) {
  const leftSide: GridCoordinate[] = [];
  const rightSide: GridCoordinate[] = [];
  const bottomSide: GridCoordinate[] = [];

  for (let row = 0; row < rowCount; row += 1) {
    const columns = getTriangleRowColumns(row, columnCount, rowCount);

    if (columns.length === 0) {
      continue;
    }

    leftSide.push({ x: columns[0], y: row });
    rightSide.push({ x: columns[columns.length - 1], y: row });

    if (row === rowCount - 1) {
      columns.forEach((column) => bottomSide.push({ x: column, y: row }));
    }
  }

  return [...leftSide, ...bottomSide.slice(1, -1), ...rightSide.reverse()];
}

function createTriangleSpinePath(columnCount: number, rowCount: number) {
  const path: GridCoordinate[] = [];
  const centerColumn = Math.floor(columnCount / 2);

  for (let row = 0; row < rowCount; row += 1) {
    if (isTriangleGridCoordinate(centerColumn, row, columnCount, rowCount)) {
      path.push({ x: centerColumn, y: row });
    }
  }

  return path;
}

function getTriangleSnakeOrder(
  x: number,
  y: number,
  columnCount: number,
  rowCount: number,
) {
  let order = 0;

  for (let row = 0; row < y; row += 1) {
    order += getTriangleRowColumns(row, columnCount, rowCount).length;
  }

  const columns = getTriangleRowColumns(y, columnCount, rowCount);
  const rowOrder =
    y % 2 === 0 ? columns.indexOf(x) : [...columns].reverse().indexOf(x);

  return rowOrder < 0 ? 0 : order + rowOrder;
}

const triangleGridItemCount = createTriangleRowsPath(
  voiceGridSize,
  voiceGridSize,
).length;

function createConnectingPath(columnCount: number, rowCount: number) {
  const pause = Array.from({ length: 6 }, () => ({ x: -1, y: -1 }));

  return [
    ...createTriangleRowsPath(columnCount, rowCount).reverse(),
    ...pause,
    ...createTrianglePerimeterPath(columnCount, rowCount),
    ...pause,
    ...createTriangleSpinePath(columnCount, rowCount),
    ...pause,
  ];
}

function createListeningPath(columnCount: number, rowCount: number) {
  const empty = { x: -1, y: -1 };
  const startX = Math.floor(columnCount / 2) - Math.floor(1.5);
  const startY = Math.floor(rowCount / 2) - Math.floor(1.5);
  const path: GridCoordinate[] = [];

  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      path.push({ x: startX + column, y: startY + row });
    }
  }

  return [...path, empty, empty, empty, empty, empty, empty];
}

function useLiveKitPattern(state: VoiceGridState, interval = 210) {
  const [step, setStep] = useState(0);
  const path = useMemo(() => {
    if (state === "connecting") {
      return createConnectingPath(voiceGridSize, voiceGridSize);
    }

    if (state === "listening") {
      return createListeningPath(voiceGridSize, voiceGridSize);
    }

    return createConnectingPath(voiceGridSize, voiceGridSize);
  }, [state]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setStep((currentStep) => currentStep + 1);
    }, interval);

    return () => window.clearInterval(intervalId);
  }, [interval, path.length, state]);

  return {
    path,
    step,
  };
}

function TriangleSurface() {
  return (
    <span
      aria-hidden="true"
      className="absolute -inset-1 z-[-1] overflow-hidden bg-cyan-200/[0.035]"
      style={{ clipPath: ROUNDED_TRIANGLE_CLIP_PATH }}
    >
      <span className="lk-triangle-surface-glow absolute inset-0" />
      <span
        className="absolute bg-[#030303]"
        style={{ clipPath: ROUNDED_TRIANGLE_CLIP_PATH, inset: 2 }}
      />
      <span className="lk-triangle-surface-sheen absolute inset-0" />
    </span>
  );
}

function TriangleFrame() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute -inset-1 z-20 overflow-visible"
      viewBox="0 0 100 100"
    >
      <path className="lk-triangle-fill" d={ROUNDED_TRIANGLE_PATH} />
      <path
        className="lk-triangle-outer-glow"
        d={ROUNDED_TRIANGLE_PATH}
        fill="none"
        pathLength="100"
        vectorEffect="non-scaling-stroke"
      />
      <path
        className="lk-triangle-frame"
        d={ROUNDED_TRIANGLE_PATH}
        fill="none"
        pathLength="100"
        vectorEffect="non-scaling-stroke"
      />
      <path
        className="lk-triangle-hairline"
        d={ROUNDED_TRIANGLE_PATH}
        fill="none"
        pathLength="100"
        vectorEffect="non-scaling-stroke"
      />
      <path
        className="lk-triangle-echo lk-triangle-echo-a"
        d={ROUNDED_TRIANGLE_PATH}
        fill="none"
        pathLength="100"
        vectorEffect="non-scaling-stroke"
      />
      <path
        className="lk-triangle-echo lk-triangle-echo-b"
        d={ROUNDED_TRIANGLE_PATH}
        fill="none"
        pathLength="100"
        vectorEffect="non-scaling-stroke"
      />
      <path
        className="lk-triangle-trace"
        d={ROUNDED_TRIANGLE_PATH}
        fill="none"
        pathLength="100"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function CrownFrame() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute left-[46.5%] top-[-40%] z-[24] h-[82%] w-[82%] overflow-visible opacity-100"
      viewBox="0 0 100 100"
      style={{
        transform: "translateX(-50%) rotate(-14deg)",
        transformOrigin: "50% 68%",
      }}
    >
      <path
        className="lk-crown-fill"
        d={`${CROWN_PRIMARY_PATH} ${CROWN_BASE_PATH}`}
        fillRule="evenodd"
      />
      <path
        className="lk-crown-track"
        d={`${CROWN_PRIMARY_PATH} ${CROWN_BASE_PATH}`}
        pathLength="100"
      />
      <path
        className="lk-crown-line"
        d={`${CROWN_PRIMARY_PATH} ${CROWN_BASE_PATH}`}
        pathLength="100"
      />
      <path className="lk-crown-inner" d={CROWN_INNER_PATH} pathLength="100" />
    </svg>
  );
}

function VoiceSignalSquare({
  active,
  connecting,
  contextBridgeActive,
  contextAttached,
  summarizing,
  bronVoiceLevel,
  voiceLevel,
  onToggle,
}: {
  active: boolean;
  connecting: boolean;
  contextBridgeActive: boolean;
  contextAttached: boolean;
  summarizing: boolean;
  bronVoiceLevel: number;
  voiceLevel: number;
  onToggle: () => void;
}) {
  const state: VoiceGridState =
    summarizing || connecting || !active ? "connecting" : "listening";
  const { path: signalPath, step: signalStep } = useLiveKitPattern(
    state,
    summarizing ? 64 : state === "connecting" ? 48 : 96,
  );
  const gridRef = useRef<HTMLSpanElement>(null);
  const [pointerCoordinate, setPointerCoordinate] =
    useState<GridCoordinate | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const clickPulseTimerRef = useRef<number | null>(null);
  const [isClickPulseActive, setIsClickPulseActive] = useState(false);
  const [clickBurst, setClickBurst] = useState(0);
  const center = (voiceGridSize - 1) / 2;
  const combinedVoiceLevel = Math.max(voiceLevel, bronVoiceLevel);
  const bronPulse = active && bronVoiceLevel > 0.025 ? bronVoiceLevel : 0;
  const activeRadius = 1.1 + combinedVoiceLevel * 5.4;
  const haloRadius = activeRadius + 1.8;
  const scanTrail = useMemo(() => {
    const trail = new Map<number, number>();

    if (state !== "connecting" || signalPath.length === 0) {
      return trail;
    }

    let previousCoordinate: GridCoordinate | null = null;

    for (let offset = 0; offset < 10; offset += 1) {
      const coordinate =
        signalPath[
          (signalStep - offset + signalPath.length) % signalPath.length
        ];

      if (!coordinate || coordinate.x < 0 || coordinate.y < 0) {
        break;
      }

      if (
        previousCoordinate &&
        Math.hypot(
          coordinate.x - previousCoordinate.x,
          coordinate.y - previousCoordinate.y,
        ) > 1.5
      ) {
        break;
      }

      const index = coordinate.y * voiceGridSize + coordinate.x;
      trail.set(index, Math.max(trail.get(index) ?? 0, 1 - offset / 10));
      previousCoordinate = coordinate;
    }

    return trail;
  }, [signalPath, signalStep, state]);

  function updatePointerCoordinate(event: SquarePointerEvent) {
    const rect = gridRef.current?.getBoundingClientRect();

    if (!rect) {
      return false;
    }

    const isInsideGrid =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;

    if (!isInsideGrid) {
      setPointerCoordinate(null);
      return false;
    }

    const x = Math.max(
      0,
      Math.min(
        voiceGridSize - 1,
        Math.floor(((event.clientX - rect.left) / rect.width) * voiceGridSize),
      ),
    );
    const y = Math.max(
      0,
      Math.min(
        voiceGridSize - 1,
        Math.floor(((event.clientY - rect.top) / rect.height) * voiceGridSize),
      ),
    );
    setPointerCoordinate({ x, y });

    return true;
  }

  function handleSquareClick() {
    if (summarizing) {
      return;
    }

    if (!active) {
      setClickBurst((currentBurst) => currentBurst + 1);
      setIsClickPulseActive(true);

      if (clickPulseTimerRef.current !== null) {
        window.clearTimeout(clickPulseTimerRef.current);
      }

      clickPulseTimerRef.current = window.setTimeout(() => {
        setIsClickPulseActive(false);
        clickPulseTimerRef.current = null;
      }, 2000);
    }

    onToggle();
  }

  useEffect(() => {
    return () => {
      if (clickPulseTimerRef.current !== null) {
        window.clearTimeout(clickPulseTimerRef.current);
      }
    };
  }, []);

  const shouldShowConnectionPulse =
    summarizing || connecting || isClickPulseActive;

  return (
    <div className="relative grid w-full place-items-center py-10 sm:py-12">
      <div
        className={cn(
          "group relative z-50 mx-auto grid min-h-[238px] w-[min(30rem,calc(100vw-2.5rem))] touch-none place-items-center gap-8 outline-none transition duration-300 sm:min-h-[308px]",
        )}
      >
        <span
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 z-[-2] h-[22rem] w-[min(84rem,calc(100vw-1rem))] -translate-x-1/2 -translate-y-1/2 overflow-hidden opacity-95 transition-opacity duration-300 [mask-image:linear-gradient(90deg,transparent_0%,black_8%,black_92%,transparent_100%)] sm:h-[30rem]"
          style={{ "--lk-bron-level": bronPulse } as CSSProperties}
        >
          <span className="absolute left-1/2 top-1/2 grid -translate-x-1/2 -translate-y-1/2 gap-[7px] [mask-image:radial-gradient(ellipse_at_center,black_0%,black_50%,transparent_86%)]">
            <span
              className="grid gap-x-[6px] gap-y-[7px]"
              style={{
                gridTemplateColumns: `repeat(${ambientPixelColumns}, 3px)`,
              }}
            >
              {ambientPixels.map((pixel, index) => (
                <span
                  key={index}
                  className={cn(
                    "size-[3px] bg-white [clip-path:polygon(50%_0%,0%_100%,100%_100%)]",
                    pixel.isVisible
                      ? "animate-[lk-ambient-star_var(--lk-star-duration)_ease-in-out_var(--lk-star-delay)_infinite]"
                      : "opacity-0",
                  )}
                  data-dimmed={pixel.isDimmed}
                  data-visible={pixel.isVisible}
                  style={
                    {
                      "--lk-star-base": pixel.baseOpacity,
                      "--lk-star-bright": pixel.brightOpacity,
                      "--lk-star-delay": `${pixel.animationDelay}s`,
                      "--lk-star-dim": pixel.dimOpacity,
                      "--lk-star-duration": `${pixel.animationDuration}s`,
                      "--lk-star-angle": `${pixel.rotation}deg`,
                    } as CSSProperties
                  }
                />
              ))}
            </span>
          </span>
        </span>
        <button
          type="button"
          onClick={handleSquareClick}
          disabled={summarizing}
          data-voice-square="true"
          aria-pressed={active}
          aria-label={
            summarizing
              ? "Summarizing task"
              : active
                ? "End voice conversation"
                : "Start voice conversation"
          }
          style={{ "--lk-bron-level": bronPulse } as CSSProperties}
          className={cn(
            "group/signal relative cursor-pointer bg-transparent p-0 outline-none transition-[filter] duration-200",
            "focus-visible:ring-3 focus-visible:ring-cyan-300/35",
            summarizing || active || connecting
              ? "drop-shadow-[0_0_30px_rgba(31,213,249,0.16)]"
              : "drop-shadow-none",
            summarizing &&
              "cursor-default drop-shadow-[0_0_44px_rgba(31,213,249,0.24)]",
          )}
          onPointerDown={(event) => {
            if (!updatePointerCoordinate(event)) {
              return;
            }

            setIsDragging(true);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerEnter={updatePointerCoordinate}
          onPointerLeave={() => {
            if (!isDragging) {
              setPointerCoordinate(null);
            }
          }}
          onPointerMove={updatePointerCoordinate}
          onPointerUp={(event) => {
            setIsDragging(false);
            updatePointerCoordinate(event);

            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onPointerCancel={(event) => {
            setIsDragging(false);
            setPointerCoordinate(null);

            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onMouseEnter={updatePointerCoordinate}
          onMouseLeave={() => {
            if (!isDragging) {
              setPointerCoordinate(null);
            }
          }}
          onMouseMove={updatePointerCoordinate}
        >
          <TriangleSurface />
          <TriangleFrame />
          <CrownFrame />
          {summarizing ? (
            <svg
              aria-hidden="true"
              className="lk-loading-snake"
              viewBox="0 0 100 100"
            >
              <path
                className="lk-loading-snake-track"
                d={ROUNDED_TRIANGLE_PATH}
                pathLength="100"
              />
              <path
                className="lk-loading-snake-line"
                d={ROUNDED_TRIANGLE_PATH}
                pathLength="100"
              />
            </svg>
          ) : null}
          {shouldShowConnectionPulse ? (
            <span
              key={clickBurst}
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute -inset-2 z-20 border border-transparent",
                connecting || summarizing
                  ? "animate-[lk-square-side-flash_2s_ease-in-out_infinite]"
                  : "animate-[lk-square-side-flash_2s_ease-out_1]",
              )}
              style={{ clipPath: ROUNDED_TRIANGLE_CLIP_PATH }}
            />
          ) : null}
          {contextBridgeActive ? (
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute bottom-[-1.95rem] left-1/2 z-[-1] h-10 w-[5.8rem] -translate-x-1/2 rounded-b-[5px] border-x border-b bg-gradient-to-b transition duration-300",
                contextAttached
                  ? "border-[#c9aa72]/30 from-[#c9aa72]/[0.09] via-white/[0.025] to-transparent shadow-[0_22px_42px_rgba(201,170,114,0.08)]"
                  : "border-cyan-200/22 from-cyan-300/[0.075] via-white/[0.018] to-transparent shadow-[0_22px_42px_rgba(34,211,238,0.08)]",
              )}
            >
              <span
                className={cn(
                  "absolute left-1/2 top-2 h-[calc(100%-0.7rem)] w-px -translate-x-1/2",
                  contextAttached
                    ? "bg-gradient-to-b from-[#f0d7a0]/55 via-[#c9aa72]/24 to-transparent"
                    : "bg-gradient-to-b from-cyan-100/52 via-cyan-300/24 to-transparent",
                )}
              />
            </span>
          ) : null}
          <span
            ref={gridRef}
            aria-hidden="true"
            className="relative z-10 m-4 grid aspect-square gap-[10px] sm:m-5 sm:gap-[14px]"
            style={{
              clipPath: ROUNDED_TRIANGLE_CLIP_PATH,
              gridTemplateColumns: `repeat(${voiceGridSize}, 1fr)`,
            }}
          >
            {voiceGridItems.map((index) => {
              const x = index % voiceGridSize;
              const y = Math.floor(index / voiceGridSize);
              const isInTriangle = isTriangleGridCoordinate(
                x,
                y,
                voiceGridSize,
                voiceGridSize,
              );
              const snakeOrder = getTriangleSnakeOrder(
                x,
                y,
                voiceGridSize,
                voiceGridSize,
              );
              const snakeDuration = 4;
              const distanceFromCenter = Math.hypot(x - center, y - center);
              const scanIntensity = scanTrail.get(index) ?? 0;
              const pointerDistance =
                pointerCoordinate === null
                  ? Number.POSITIVE_INFINITY
                  : Math.hypot(
                      x - pointerCoordinate.x,
                      y - pointerCoordinate.y,
                    );
              const pointerIntensity =
                pointerCoordinate === null
                  ? 0
                  : Math.max(
                      0,
                      Math.min(
                        1,
                        ((isDragging ? 4.6 : 3.1) - pointerDistance) /
                          (isDragging ? 4.6 : 3.1),
                      ),
                    );
              const pointerDirectionX =
                pointerCoordinate !== null && pointerDistance > 0
                  ? (x - pointerCoordinate.x) / pointerDistance
                  : 0;
              const pointerDirectionY =
                pointerCoordinate !== null && pointerDistance > 0
                  ? (y - pointerCoordinate.y) / pointerDistance
                  : 0;
              const pointerAngle =
                pointerCoordinate === null || pointerDistance === 0
                  ? (x + y) % 2 === 0
                    ? 0
                    : 180
                  : Math.atan2(pointerDirectionY, pointerDirectionX) *
                      (180 / Math.PI) +
                    90;
              const voiceIntensity =
                active && !connecting
                  ? Math.max(
                      0,
                      Math.min(
                        1,
                        (haloRadius - distanceFromCenter) /
                          Math.max(haloRadius, 1),
                      ),
                    )
                  : 0;
              const totalIntensity = Math.max(
                scanIntensity,
                voiceIntensity,
                pointerIntensity,
              );
              const isScanning = scanIntensity > 0;
              const isVoiceLit = voiceIntensity > 0.08;
              const isPointerLit = pointerIntensity > 0.05;
              const scale =
                totalIntensity > 0
                  ? 1 + totalIntensity * (isDragging ? 1.45 : 0.9)
                  : undefined;
              const trianglePixelClipPath =
                (x + y) % 2 === 0
                  ? "polygon(50% 0%, 100% 100%, 0% 100%)"
                  : "polygon(0% 0%, 100% 0%, 50% 100%)";
              const bottomToTopSnakeOrder = triangleGridItemCount - 1 - snakeOrder;
              const pointerDrift = pointerIntensity * (isDragging ? 5.2 : 3.2);
              const pointerFan =
                pointerIntensity * ((x + y) % 2 === 0 ? 16 : -16);
              const pointerTilt = pointerIntensity * (pointerDirectionX * 8);
              const transform = [
                pointerIntensity > 0
                  ? `translate(${pointerDirectionX * pointerDrift}px, ${pointerDirectionY * pointerDrift}px)`
                  : null,
                pointerIntensity > 0
                  ? `rotate(${pointerAngle + pointerFan}deg)`
                  : null,
                pointerIntensity > 0 ? `skewX(${pointerTilt}deg)` : null,
                scale ? `scale(${scale})` : null,
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <span
                  key={index}
                  data-lk-index={index}
                  data-lk-highlighted={isScanning || isVoiceLit || isPointerLit}
                  className={cn(
                    "size-[5px] bg-white/[0.11] transition-all ease-out group-hover/signal:bg-white/[0.22] group-hover/signal:drop-shadow-[0_0_6px_rgba(255,255,255,0.18)] group-active:scale-125 sm:size-[5.5px]",
                    !isInTriangle && "invisible",
                    state === "connecting" &&
                      !isPointerLit &&
                      "animate-[lk-square-snake_var(--lk-snake-duration)_linear_var(--lk-snake-delay)_infinite]",
                    isScanning &&
                      "scale-125 bg-[#1fd5f9] drop-shadow-[0_0_6px_rgba(31,213,249,0.42)]",
                    isVoiceLit &&
                      "bg-[#1fd5f9] drop-shadow-[0_0_7px_rgba(31,213,249,0.38)]",
                    isPointerLit &&
                      "bg-white drop-shadow-[0_0_7px_rgba(255,255,255,0.34)]",
                  )}
                  style={
                    {
                      clipPath: trianglePixelClipPath,
                      transform: transform.length > 0 ? transform : undefined,
                      "--lk-snake-delay": `${-(bottomToTopSnakeOrder / triangleGridItemCount) * snakeDuration}s`,
                      "--lk-snake-duration": `${snakeDuration}s`,
                      transitionProperty: "all",
                      transitionDuration: `${isDragging ? 24 : isPointerLit ? 36 : active && !connecting ? 48 : 95}ms`,
                      transitionTimingFunction: "ease-out",
                    } as CSSProperties
                  }
                />
              );
            })}
          </span>
        </button>
      </div>
    </div>
  );
}

export function SpeechInputWorkbench() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const responseTimerRef = useRef<number | null>(null);
  const agentWaitTimerRef = useRef<number | null>(null);
  const handoffTimerRef = useRef<number | null>(null);
  const liveKitRoomRef = useRef<Room | null>(null);
  const micAnalyserRef = useRef<AudioAnalyserHandle | null>(null);
  const micAnalyserFrameRef = useRef<number | null>(null);
  const micLevelRef = useRef(0);
  const bronAnalyserRef = useRef<AudioAnalyserHandle | null>(null);
  const bronAnalyserFrameRef = useRef<number | null>(null);
  const bronAudioTrackIdRef = useRef<string | null>(null);
  const bronVoiceLevelRef = useRef(0);
  const remoteAudioElementsRef = useRef<HTMLMediaElement[]>([]);
  const attachedAudioTrackIdsRef = useRef<Set<string>>(new Set());
  const conversationRef = useRef<ConversationMessage[]>(
    loadStoredConversationMessages(),
  );
  const spokenInputRef = useRef("");
  const isSummarizingRef = useRef(false);
  const hasStartedRoutingRef = useRef(false);
  const [fileName, setFileName] = useState("");
  const [isDatasetUploadPrompted, setIsDatasetUploadPrompted] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isConnectingVoice, setIsConnectingVoice] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [bronVoiceLevel, setBronVoiceLevel] = useState(0);
  const [, setVoiceResponse] = useState("");
  const hasDataInput = fileName.length > 0;
  const shouldShowDatasetUpload = isDatasetUploadPrompted || hasDataInput;
  const tokenMutation = api.livekit.createToken.useMutation();
  const summarizeMutation = api.conversation.summarize.useMutation();

  function handleFiles(fileList: FileList | null) {
    const file = fileList?.[0];

    if (file) {
      storeAttachedDataset(file);
      setFileName(file.name);
      setIsDatasetUploadPrompted(true);
    }
  }

  function showDatasetUploadPrompt() {
    setIsDatasetUploadPrompted(true);
  }

  function appendConversationMessage(message: ConversationMessage) {
    const currentConversation = conversationRef.current;
    const lastMessage = currentConversation.at(-1);

    if (
      lastMessage?.role === message.role &&
      lastMessage.content === message.content
    ) {
      return;
    }

    const nextConversation = [...currentConversation, message];
    conversationRef.current = nextConversation;
    storeConversationMessages(nextConversation);
  }

  function showTemporaryResponse(message: string, timeout = 4200) {
    setVoiceResponse(message);

    if (responseTimerRef.current) {
      window.clearTimeout(responseTimerRef.current);
    }

    responseTimerRef.current = window.setTimeout(() => {
      setVoiceResponse("");
      responseTimerRef.current = null;
    }, timeout);
  }

  function clearVoiceResponse() {
    setVoiceResponse("");

    if (responseTimerRef.current) {
      window.clearTimeout(responseTimerRef.current);
      responseTimerRef.current = null;
    }
  }

  function clearAgentWaitTimer() {
    if (agentWaitTimerRef.current) {
      window.clearTimeout(agentWaitTimerRef.current);
      agentWaitTimerRef.current = null;
    }
  }

  function detachRemoteAudio() {
    remoteAudioElementsRef.current.forEach((element) => element.remove());
    remoteAudioElementsRef.current = [];
    attachedAudioTrackIdsRef.current.clear();
    stopBronAnalyser();
  }

  function stopMicAnalyser() {
    if (micAnalyserFrameRef.current !== null) {
      window.cancelAnimationFrame(micAnalyserFrameRef.current);
      micAnalyserFrameRef.current = null;
    }

    void micAnalyserRef.current?.cleanup().catch(() => undefined);
    micAnalyserRef.current = null;
    micLevelRef.current = 0;
    setMicLevel(0);
  }

  function stopBronAnalyser(trackId?: string) {
    if (trackId && bronAudioTrackIdRef.current !== trackId) {
      return;
    }

    if (bronAnalyserFrameRef.current !== null) {
      window.cancelAnimationFrame(bronAnalyserFrameRef.current);
      bronAnalyserFrameRef.current = null;
    }

    void bronAnalyserRef.current?.cleanup().catch(() => undefined);
    bronAnalyserRef.current = null;
    bronAudioTrackIdRef.current = null;
    bronVoiceLevelRef.current = 0;
    setBronVoiceLevel(0);
  }

  function startBronAnalyser(track: RemoteAudioTrack, trackId: string) {
    stopBronAnalyser();

    try {
      const analyser = createAudioAnalyser(track, {
        fftSize: 1024,
        smoothingTimeConstant: 0.54,
        minDecibels: -90,
        maxDecibels: -16,
      });

      bronAnalyserRef.current = analyser;
      bronAudioTrackIdRef.current = trackId;

      const readBronLevel = () => {
        const rawLevel = analyser.calculateVolume();
        const nextLevel = Math.max(0, Math.min(1, (rawLevel - 0.012) * 9.4));
        const smoothedLevel =
          bronVoiceLevelRef.current * 0.58 + nextLevel * 0.42;

        if (
          Math.abs(smoothedLevel - bronVoiceLevelRef.current) > 0.012 ||
          smoothedLevel < 0.008
        ) {
          bronVoiceLevelRef.current = smoothedLevel;
          setBronVoiceLevel(smoothedLevel < 0.008 ? 0 : smoothedLevel);
        } else {
          bronVoiceLevelRef.current = smoothedLevel;
        }

        bronAnalyserFrameRef.current =
          window.requestAnimationFrame(readBronLevel);
      };

      bronAnalyserFrameRef.current =
        window.requestAnimationFrame(readBronLevel);
    } catch {
      stopBronAnalyser(trackId);
    }
  }

  function startMicAnalyser(track?: LocalAudioTrack) {
    if (!track) {
      return;
    }

    stopMicAnalyser();

    try {
      const analyser = createAudioAnalyser(track, {
        fftSize: 1024,
        smoothingTimeConstant: 0.62,
        minDecibels: -92,
        maxDecibels: -18,
      });

      micAnalyserRef.current = analyser;

      const readMicLevel = () => {
        const rawLevel = analyser.calculateVolume();
        const nextLevel = Math.max(0, Math.min(1, (rawLevel - 0.018) * 7.5));
        const smoothedLevel = micLevelRef.current * 0.68 + nextLevel * 0.32;

        if (
          Math.abs(smoothedLevel - micLevelRef.current) > 0.015 ||
          smoothedLevel < 0.01
        ) {
          micLevelRef.current = smoothedLevel;
          setMicLevel(smoothedLevel < 0.01 ? 0 : smoothedLevel);
        } else {
          micLevelRef.current = smoothedLevel;
        }

        micAnalyserFrameRef.current =
          window.requestAnimationFrame(readMicLevel);
      };

      micAnalyserFrameRef.current = window.requestAnimationFrame(readMicLevel);
    } catch {
      setMicLevel(0);
    }
  }

  useEffect(() => {
    router.prefetch("/agents");

    return () => {
      const room = liveKitRoomRef.current;
      liveKitRoomRef.current = null;
      stopMicAnalyser();
      remoteAudioElementsRef.current.forEach((element) => element.remove());
      remoteAudioElementsRef.current = [];
      stopBronAnalyser();
      void room?.localParticipant
        .setMicrophoneEnabled(false)
        .catch(() => undefined);
      room?.disconnect();

      if (responseTimerRef.current) {
        window.clearTimeout(responseTimerRef.current);
      }

      if (agentWaitTimerRef.current) {
        window.clearTimeout(agentWaitTimerRef.current);
      }

      if (handoffTimerRef.current) {
        window.clearTimeout(handoffTimerRef.current);
      }
    };
  }, [router]);

  function subscribeAudioPublication(
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) {
    if (publication.kind !== Track.Kind.Audio) {
      return;
    }

    participant.setVolume(1);
    publication.setEnabled(true);
    publication.setSubscribed(true);

    if (publication.track) {
      handleTrackSubscribed(publication.track, publication, participant);
    }
  }

  function waitForLocalMicrophone(room: Room) {
    return new Promise<void>((resolve) => {
      let isResolved = false;
      let timeoutId: number | null = null;

      const finish = () => {
        if (isResolved) {
          return;
        }

        isResolved = true;
        room.off(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);

        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }

        resolve();
      };

      const handleLocalTrackPublished = (publication: {
        kind?: Track.Kind;
      }) => {
        if (publication.kind === Track.Kind.Audio) {
          finish();
        }
      };

      room.on(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);
      timeoutId = window.setTimeout(finish, 2000);
    });
  }

  async function stopLiveKitRoom() {
    const room = liveKitRoomRef.current;
    liveKitRoomRef.current = null;
    setIsListening(false);
    setIsConnectingVoice(false);
    clearVoiceResponse();
    clearAgentWaitTimer();
    stopMicAnalyser();
    detachRemoteAudio();

    if (!room) {
      return;
    }

    await room.localParticipant
      .setMicrophoneEnabled(false)
      .catch(() => undefined);
    room.disconnect();
  }

  async function handleSignOut() {
    if (handoffTimerRef.current) {
      window.clearTimeout(handoffTimerRef.current);
      handoffTimerRef.current = null;
    }

    await stopLiveKitRoom();
    conversationRef.current = [];
    spokenInputRef.current = "";
    isSummarizingRef.current = false;
    hasStartedRoutingRef.current = false;
    setIsSummarizing(false);
    setFileName("");
    setIsDatasetUploadPrompted(false);
    window.sessionStorage.removeItem(CONVERSATION_MESSAGES_STORAGE_KEY);
    window.sessionStorage.removeItem("f1-agent-conversation-summary");
    window.sessionStorage.removeItem(ATTACHED_DATASET_STORAGE_KEY);
    delete (window as AttachedDatasetWindow).__f1AgentAttachedDataset;
    router.push("/");
  }

  function handleTrackSubscribed(
    track: RemoteTrack,
    _publication?: RemoteTrackPublication,
    participant?: RemoteParticipant,
  ) {
    if (track.kind !== Track.Kind.Audio) {
      return;
    }

    const trackId = track.sid ?? track.mediaStreamTrack.id;

    if (attachedAudioTrackIdsRef.current.has(trackId)) {
      return;
    }

    attachedAudioTrackIdsRef.current.add(trackId);
    participant?.setVolume(1);
    const audioTrack = track as RemoteAudioTrack;
    audioTrack.setVolume(1);

    const element = audioTrack.attach();
    element.autoplay = true;
    element.volume = 1;
    element.muted = false;
    element.setAttribute("playsinline", "");
    element.setAttribute("webkit-playsinline", "");
    element.setAttribute("data-bron-audio", trackId);
    element.style.position = "absolute";
    element.style.width = "1px";
    element.style.height = "1px";
    element.style.opacity = "0";
    element.style.pointerEvents = "none";
    document.body.appendChild(element);
    remoteAudioElementsRef.current = [
      ...remoteAudioElementsRef.current,
      element,
    ];

    if (!participant || !participant.identity.startsWith("speaker-")) {
      startBronAnalyser(audioTrack, trackId);
    }

    void liveKitRoomRef.current
      ?.startAudio()
      .then(() => element.play())
      .catch(() => {
        showTemporaryResponse(
          "Audio is blocked. Click the voice button again to resume playback.",
        );
      });
  }

  function handleTrackUnsubscribed(track: RemoteTrack) {
    const trackId = track.sid ?? track.mediaStreamTrack.id;
    attachedAudioTrackIdsRef.current.delete(trackId);
    stopBronAnalyser(trackId);
    track.detach().forEach((element) => {
      element.remove();
      remoteAudioElementsRef.current = remoteAudioElementsRef.current.filter(
        (audio) => audio !== element,
      );
    });
  }

  function handleTranscriptText(
    identity: string,
    text: string,
    isFinal: boolean,
  ) {
    const transcript = text.trim();

    if (transcript.length === 0) {
      return;
    }

    const role = getRoleFromIdentity(identity);

    setVoiceResponse(`${getDisplaySpeaker(role)}: ${transcript}`);

    if (!isFinal) {
      return;
    }

    appendConversationMessage({ role, content: transcript });

    if (role === "user") {
      spokenInputRef.current = transcript;

      if (mentionsCustomDataset(transcript)) {
        showDatasetUploadPrompt();
      }
    }
  }

  async function handleCustomDatasetUploadStream(
    reader: AsyncIterable<string>,
  ) {
    for await (const chunk of reader) {
      if (chunk.length > 0) {
        continue;
      }
    }

    showDatasetUploadPrompt();
  }

  async function handleStartAgentWorkStream(reader: AsyncIterable<string>) {
    for await (const chunk of reader) {
      if (chunk.length > 0) {
        continue;
      }
    }

    startAgentWorkHandoff();
  }

  function startAgentWorkHandoff() {
    if (isSummarizingRef.current || handoffTimerRef.current) {
      return;
    }

    isSummarizingRef.current = true;
    setIsSummarizing(true);
    handoffTimerRef.current = window.setTimeout(() => {
      handoffTimerRef.current = null;
      void continueToAgents();
    }, START_AGENT_WORK_HANDOFF_DELAY_MS);
  }

  async function handleTranscriptionStream(
    reader: AsyncIterable<string> & {
      info: { attributes?: Record<string, string> };
    },
    identity: string,
  ) {
    const isFinal =
      reader.info.attributes?.[TRANSCRIPTION_FINAL_ATTRIBUTE] === "true";
    let latestText = "";

    for await (const chunk of reader) {
      const text = chunk.trim();

      if (text.length === 0) {
        continue;
      }

      latestText = text;
      handleTranscriptText(identity, latestText, false);
    }

    if (isFinal && latestText.length > 0) {
      handleTranscriptText(identity, latestText, true);
    }
  }

  async function startLiveKitRoom() {
    if (liveKitRoomRef.current) {
      return;
    }

    setIsConnectingVoice(true);
    setIsListening(true);
    clearVoiceResponse();

    try {
      const identity = createIdentity();
      const room = new Room();
      const voiceRoom = createVoiceRoomName(identity);

      liveKitRoomRef.current = room;
      void room.startAudio().catch(() => undefined);
      room.registerTextStreamHandler(
        TRANSCRIPTION_TOPIC,
        (reader, participantInfo) => {
          void handleTranscriptionStream(
            reader,
            participantInfo.identity,
          ).catch(() => {
            showTemporaryResponse(
              "Could not read the LiveKit transcript stream.",
            );
          });
        },
      );
      room.registerTextStreamHandler(CUSTOM_DATASET_UPLOAD_TOPIC, (reader) => {
        void handleCustomDatasetUploadStream(reader).catch(() => {
          showDatasetUploadPrompt();
        });
      });
      room.registerTextStreamHandler(START_AGENT_WORK_TOPIC, (reader) => {
        void handleStartAgentWorkStream(reader).catch((error) => {
          showTemporaryResponse(
            error instanceof Error
              ? error.message
              : "Could not start agent work.",
          );
        });
      });

      room.on(RoomEvent.ParticipantConnected, (participant) => {
        if (!participant.identity.startsWith("speaker-")) {
          setIsConnectingVoice(false);
          clearAgentWaitTimer();
          showTemporaryResponse("Voice agent connected. Speak now.", 2600);
        }

        participant.trackPublications.forEach((publication) => {
          subscribeAudioPublication(publication, participant);
        });
      });
      room.on(RoomEvent.TrackPublished, (publication, participant) => {
        subscribeAudioPublication(publication, participant);
      });
      room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
      room.on(RoomEvent.TrackSubscriptionFailed, (_trackSid, participant) => {
        if (!participant.identity.startsWith("speaker-")) {
          showTemporaryResponse("Agent audio track could not be subscribed.");
        }
      });
      room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
      room.on(RoomEvent.LocalAudioSilenceDetected, () => {
        showTemporaryResponse(
          "Your mic is connected, but LiveKit detects silence. Check the input device.",
        );
      });
      room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
        if (!room.canPlaybackAudio) {
          showTemporaryResponse(
            "Audio is blocked. Click the voice button again to resume playback.",
          );
          return;
        }

        void Promise.all(
          remoteAudioElementsRef.current.map((element) =>
            element.play().catch(() => undefined),
          ),
        );
      });
      room.on(RoomEvent.Disconnected, () => {
        liveKitRoomRef.current = null;
        setIsListening(false);
        setIsConnectingVoice(false);
        clearAgentWaitTimer();
        stopMicAnalyser();
        detachRemoteAudio();
      });

      const { token, url } = await tokenMutation.mutateAsync({
        identity,
        room: voiceRoom,
        name: "Driver",
        metadata: JSON.stringify({ feature: "livekit-model-conversation" }),
        canPublish: true,
        canSubscribe: true,
        dispatchAgent: true,
      });
      await room.connect(url, token);
      await room.startAudio();
      const microphoneReady = waitForLocalMicrophone(room);
      const microphonePublication =
        await room.localParticipant.setMicrophoneEnabled(true, {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        });
      startMicAnalyser(microphonePublication?.audioTrack);
      await microphoneReady;

      if (
        !Array.from(room.remoteParticipants.values()).some(
          (participant) => !participant.identity.startsWith("speaker-"),
        )
      ) {
        agentWaitTimerRef.current = window.setTimeout(() => {
          showTemporaryResponse(
            "Mic connected, but the voice agent has not joined. Check the dev terminal.",
            9000,
          );
        }, 8000);
      }

      room.remoteParticipants.forEach((participant) => {
        if (!participant.identity.startsWith("speaker-")) {
          setIsConnectingVoice(false);
          clearAgentWaitTimer();
          showTemporaryResponse("Voice agent connected. Speak now.", 2600);
        }

        participant.trackPublications.forEach((publication) => {
          subscribeAudioPublication(publication, participant);
        });
      });
      showTemporaryResponse("Mic connected. Waiting for speech...", 3000);
    } catch (error) {
      setIsConnectingVoice(false);
      throw error;
    }
  }

  async function startSpeechInput() {
    if (isListening || liveKitRoomRef.current) {
      await stopLiveKitRoom();
      return;
    }

    try {
      await startLiveKitRoom();
    } catch (error) {
      liveKitRoomRef.current = null;
      setIsListening(false);
      setIsConnectingVoice(false);
      clearAgentWaitTimer();
      showTemporaryResponse(
        error instanceof Error ? error.message : "Could not connect LiveKit.",
      );
    }
  }

  useEffect(() => {
    function handleEscapeKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || (!isListening && !liveKitRoomRef.current)) {
        return;
      }

      event.preventDefault();
      const room = liveKitRoomRef.current;
      liveKitRoomRef.current = null;
      setIsListening(false);
      setIsConnectingVoice(false);
      setVoiceResponse("Conversation ended.");

      if (responseTimerRef.current) {
        window.clearTimeout(responseTimerRef.current);
      }

      responseTimerRef.current = window.setTimeout(() => {
        setVoiceResponse("");
        responseTimerRef.current = null;
      }, 1800);

      if (agentWaitTimerRef.current) {
        window.clearTimeout(agentWaitTimerRef.current);
        agentWaitTimerRef.current = null;
      }

      if (micAnalyserFrameRef.current !== null) {
        window.cancelAnimationFrame(micAnalyserFrameRef.current);
        micAnalyserFrameRef.current = null;
      }

      void micAnalyserRef.current?.cleanup().catch(() => undefined);
      micAnalyserRef.current = null;
      micLevelRef.current = 0;
      setMicLevel(0);
      remoteAudioElementsRef.current.forEach((element) => element.remove());
      remoteAudioElementsRef.current = [];
      attachedAudioTrackIdsRef.current.clear();
      void room?.localParticipant
        .setMicrophoneEnabled(false)
        .catch(() => undefined);
      room?.disconnect();
    }

    window.addEventListener("keydown", handleEscapeKey);

    return () => window.removeEventListener("keydown", handleEscapeKey);
  }, [isListening]);

  async function continueToAgents() {
    if (hasStartedRoutingRef.current) {
      return;
    }

    hasStartedRoutingRef.current = true;

    if (!isSummarizingRef.current) {
      isSummarizingRef.current = true;
      setIsSummarizing(true);
    }

    if (handoffTimerRef.current) {
      window.clearTimeout(handoffTimerRef.current);
      handoffTimerRef.current = null;
    }

    await stopLiveKitRoom();

    try {
      const latestConversation = conversationRef.current;
      const latestSpokenIntent = spokenInputRef.current.trim();
      const summaryMessages =
        latestConversation.length > 0
          ? latestConversation
          : [
              {
                role: "user" as const,
                content:
                  latestSpokenIntent || "The user asked Bron to start working.",
              },
            ];
      const { summary } = await summarizeMutation.mutateAsync({
        messages: summaryMessages,
      });

      window.sessionStorage.setItem("f1-agent-conversation-summary", summary);
      window.sessionStorage.removeItem(CONVERSATION_MESSAGES_STORAGE_KEY);
      router.push("/agents", {
        scroll: false,
        transitionTypes: ["nav-forward"],
      });
    } catch (error) {
      showTemporaryResponse(
        error instanceof Error
          ? error.message
          : "Could not summarize conversation.",
      );
      isSummarizingRef.current = false;
      hasStartedRoutingRef.current = false;
      setIsSummarizing(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#030303] px-5 text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-80"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.032) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.032) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
          maskImage:
            "radial-gradient(circle at center, black 0%, black 54%, transparent 100%)",
        }}
      />
      {isSummarizing ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[6] bg-[#030303]/58 backdrop-blur-[1px] [mask-image:radial-gradient(circle_at_center,transparent_0%,transparent_28%,black_76%)]"
        />
      ) : null}

      <header className="relative z-20 flex h-20 items-center justify-between">
        <button
          type="button"
          onClick={() => router.push("/speech")}
          className="text-base font-semibold tracking-[0.16em] text-white/88 transition hover:text-white"
        >
          Lebronsseiur
        </button>

        <button
          type="button"
          onClick={() => void handleSignOut()}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-white/12 bg-white/[0.035] px-3.5 text-sm font-medium text-white/72 transition hover:border-white/24 hover:bg-white/[0.065] hover:text-white focus-visible:ring-3 focus-visible:ring-cyan-300/28"
        >
          <LogOut className="size-4" strokeWidth={1.8} />
          Sign out
        </button>
      </header>

      <section className="relative z-10 grid min-h-[calc(100vh-5rem)] place-items-center pb-24 pt-2">
        <div className="flex w-[calc(100vw-2.5rem)] max-w-[46rem] flex-col items-center">
          <div className="relative grid w-full place-items-center">
            <VoiceSignalSquare
              active={isListening}
              connecting={isConnectingVoice}
              contextAttached={hasDataInput}
              contextBridgeActive={shouldShowDatasetUpload}
              summarizing={isSummarizing}
              bronVoiceLevel={bronVoiceLevel}
              voiceLevel={micLevel}
              onToggle={startSpeechInput}
            />

            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute left-1/2 top-[calc(50%+6.1rem)] z-[55] h-[6.35rem] w-28 -translate-x-1/2 origin-bottom transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] sm:top-[calc(50%+6.9rem)]",
                shouldShowDatasetUpload
                  ? "translate-y-0 scale-100 opacity-100"
                  : "translate-y-7 scale-95 opacity-0",
              )}
            >
              <span
                className={cn(
                  "absolute left-1/2 top-0 h-[calc(100%-1.35rem)] w-px -translate-x-1/2",
                  hasDataInput
                    ? "bg-gradient-to-b from-[#f0d7a0]/52 via-[#c9aa72]/24 to-transparent"
                    : "bg-gradient-to-b from-cyan-100/45 via-cyan-300/22 to-transparent",
                )}
              />
              <span
                className={cn(
                  "absolute left-1/2 top-2 h-[4.75rem] w-[5.9rem] -translate-x-1/2 rounded-b-md border border-t-0 bg-[#040607]/88 shadow-[0_20px_44px_rgba(0,0,0,0.34),inset_0_-1px_0_rgba(255,255,255,0.045)]",
                  hasDataInput ? "border-[#c9aa72]/24" : "border-cyan-200/16",
                )}
              />
              <span
                className={cn(
                  "absolute left-1/2 top-[1.15rem] h-[3.75rem] w-[2.6rem] -translate-x-1/2 rounded-b-sm border-x",
                  hasDataInput ? "border-[#c9aa72]/22" : "border-cyan-200/14",
                )}
              />
              <span
                className={cn(
                  "absolute bottom-[1.35rem] left-1/2 h-px w-[4.35rem] -translate-x-1/2",
                  hasDataInput
                    ? "bg-gradient-to-r from-transparent via-[#f0d7a0]/42 to-transparent"
                    : "bg-gradient-to-r from-transparent via-cyan-100/32 to-transparent",
                )}
              />
            </span>

            <div
              className={cn(
                "absolute left-1/2 top-[calc(50%+7.35rem)] z-[60] -translate-x-1/2 origin-bottom transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] sm:top-[calc(50%+8.15rem)]",
                shouldShowDatasetUpload
                  ? "translate-y-0 scale-100 opacity-100 delay-75"
                  : "pointer-events-none translate-y-8 scale-95 opacity-0",
              )}
            >
              <label
                data-dataset-upload="true"
                aria-hidden={!shouldShowDatasetUpload}
                aria-label="Upload data"
                className={cn(
                  "group/upload relative grid h-12 w-[4.65rem] shrink-0 cursor-pointer place-items-center overflow-hidden rounded-[10px] border border-cyan-200/42 bg-[#061014]/92 text-cyan-50 shadow-[0_12px_28px_rgba(0,0,0,0.38),0_0_24px_rgba(34,211,238,0.13),inset_0_1px_0_rgba(255,255,255,0.11)] transition duration-150 hover:-translate-y-0.5 hover:border-cyan-100/65 hover:bg-[#071820] hover:text-white hover:shadow-[0_14px_32px_rgba(0,0,0,0.42),0_0_28px_rgba(34,211,238,0.18),inset_0_1px_0_rgba(255,255,255,0.16)] active:translate-y-0 focus-within:ring-3 focus-within:ring-cyan-300/24",
                  hasDataInput
                    ? "border-[#c9aa72]/58 bg-[#151107]/92 text-[#f3d9a4] shadow-[0_14px_30px_rgba(0,0,0,0.42),0_0_24px_rgba(201,170,114,0.11),inset_0_1px_0_rgba(255,255,255,0.13)] hover:border-[#f0d7a0]/72 hover:bg-[#1b1509] hover:shadow-[0_16px_34px_rgba(0,0,0,0.46),0_0_28px_rgba(201,170,114,0.15),inset_0_1px_0_rgba(255,255,255,0.16)]"
                    : "",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute inset-x-2 top-1.5 h-px",
                    hasDataInput
                      ? "bg-gradient-to-r from-transparent via-[#f0d7a0]/46 to-transparent"
                      : "bg-gradient-to-r from-transparent via-cyan-100/42 to-transparent",
                  )}
                />
                <span aria-hidden="true" className="flex items-center gap-1.5">
                  <Paperclip className="size-5" strokeWidth={1.8} />
                  <span className="grid gap-0.5 opacity-70 transition group-hover/upload:opacity-100">
                    <span className={cn("h-1 w-3 rounded-[1px]", hasDataInput ? "bg-[#f0d7a0]/62" : "bg-cyan-100/55")} />
                    <span className={cn("h-1 w-4 rounded-[1px]", hasDataInput ? "bg-[#c9aa72]/48" : "bg-cyan-200/38")} />
                  </span>
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="sr-only"
                  tabIndex={shouldShowDatasetUpload ? 0 : -1}
                  onChange={(event) => handleFiles(event.target.files)}
                />
              </label>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
