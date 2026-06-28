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
import { LayoutDashboard, Paperclip } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";

const TRANSCRIPTION_TOPIC = "lk.transcription";
const TRANSCRIPTION_FINAL_ATTRIBUTE = "lk.transcription_final";
const CUSTOM_DATASET_UPLOAD_TOPIC = "lebronsseiur.custom_dataset_upload";
const START_AGENT_WORK_TOPIC = "lebronsseiur.start_agent_work";
const VOICE_ROOM_PREFIX = "lebronsseiur-model-conversation";

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
const voiceGridItems = Array.from({ length: voiceGridSize * voiceGridSize }, (_, index) => index);
const ambientPixelColumns = 124;
const ambientPixelRows = 32;

type VoiceGridState = "connecting" | "listening";
type GridCoordinate = {
  x: number;
  y: number;
};
type CursorPosition = {
  x: number;
  y: number;
};
type SquarePointerEvent = MouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>;

type AudioAnalyserHandle = ReturnType<typeof createAudioAnalyser>;

type AmbientPixel = {
  animationDelay: number;
  animationDuration: number;
  baseOpacity: number;
  brightOpacity: number;
  dimOpacity: number;
  isDimmed: boolean;
  isVisible: boolean;
};

function seededUnit(index: number, salt: number) {
  return Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453 % 1;
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
    const weightedDistance = Math.sqrt(distanceX ** 2 * 0.55 + distanceY ** 2 * 1.95);
    const phase = Math.abs(seededUnit(index, 1));
    const brightness = Math.abs(seededUnit(index, 2));
    const cadence = Math.abs(seededUnit(index, 3));
    const presence = Math.abs(seededUnit(index, 4));
    const showChance = Math.max(0.012, (0.46 * Math.max(0, 1 - weightedDistance)) ** 1.18);
    const isVisible = presence < showChance;
    const isDimmed = phase < 0.5;
    const baseOpacity = isDimmed ? 0.035 + brightness * 0.035 : 0.105 + brightness * 0.075;
    const dimOpacity = isDimmed ? 0.018 + brightness * 0.018 : 0.045 + brightness * 0.035;

    return {
      animationDelay: -phase * 7.2,
      animationDuration: 2.6 + cadence * 5.8,
      baseOpacity,
      brightOpacity: Math.min(0.58, baseOpacity + 0.18 + brightness * 0.18),
      dimOpacity,
      isDimmed,
      isVisible,
    };
  },
);

function createSerpentinePath(columnCount: number, rowCount: number) {
  const path: GridCoordinate[] = [];

  for (let column = 0; column < columnCount; column += 1) {
    if (column % 2 === 0) {
      for (let row = 0; row < rowCount; row += 1) {
        path.push({ x: column, y: row });
      }
      continue;
    }

    for (let row = rowCount - 1; row >= 0; row -= 1) {
      path.push({ x: column, y: row });
    }
  }

  return path;
}

function createPerimeterPath(columnCount: number, rowCount: number) {
  const path: GridCoordinate[] = [];

  for (let column = 0; column < columnCount; column += 1) {
    path.push({ x: column, y: 0 });
  }
  for (let row = 1; row < rowCount; row += 1) {
    path.push({ x: columnCount - 1, y: row });
  }
  for (let column = columnCount - 2; column >= 0; column -= 1) {
    path.push({ x: column, y: rowCount - 1 });
  }
  for (let row = rowCount - 2; row > 0; row -= 1) {
    path.push({ x: 0, y: row });
  }

  return path;
}

function createDiagonalPath(columnCount: number, rowCount: number) {
  const path: GridCoordinate[] = [];

  for (let diagonal = 0; diagonal < columnCount + rowCount - 1; diagonal += 1) {
    for (let row = 0; row < rowCount; row += 1) {
      const column = diagonal - row;

      if (column >= 0 && column < columnCount) {
        path.push({ x: column, y: row });
      }
    }
  }

  return path;
}

function createConnectingPath(columnCount: number, rowCount: number) {
  const pause = Array.from({ length: 6 }, () => ({ x: -1, y: -1 }));

  return [
    ...createSerpentinePath(columnCount, rowCount),
    ...pause,
    ...createPerimeterPath(columnCount, rowCount),
    ...pause,
    ...createDiagonalPath(columnCount, rowCount),
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

function ShimmerBorder({ enabled }: { enabled: boolean }) {
  const shimmerLines = [
    "animate-[lk-shimmer-quad-top_4s_ease-in-out_infinite]",
    "animate-[lk-shimmer-quad-right_4s_ease-in-out_infinite]",
    "animate-[lk-shimmer-quad-bottom_4s_ease-in-out_infinite]",
    "animate-[lk-shimmer-quad-left_4s_ease-in-out_infinite]",
  ];

  return (
    <span
      aria-hidden="true"
      className="absolute -inset-1 z-[-1] overflow-hidden bg-white/12"
      style={{ borderRadius: 8 }}
    >
      {enabled
        ? shimmerLines.map((className) => (
            <span
              key={className}
              className={cn("absolute z-0 rounded-full bg-[#1fd5f9]", className)}
              style={{
                width: 35,
                height: 35,
                transform: "translate(-50%, -50%)",
                filter: "blur(17.5px)",
              }}
            />
          ))
        : null}
      <span className="absolute bg-[#030303]" style={{ inset: 1.5, borderRadius: 6.5 }} />
    </span>
  );
}

function VoiceSignalSquare({
  active,
  connecting,
  voiceLevel,
  onToggle,
}: {
  active: boolean;
  connecting: boolean;
  voiceLevel: number;
  onToggle: () => void;
}) {
  const state: VoiceGridState = active && !connecting ? "listening" : "connecting";
  const { path: signalPath, step: signalStep } = useLiveKitPattern(state, state === "connecting" ? 210 : 120);
  const gridRef = useRef<HTMLSpanElement>(null);
  const [pointerCoordinate, setPointerCoordinate] = useState<GridCoordinate | null>(null);
  const [cursorPosition, setCursorPosition] = useState<CursorPosition | null>(null);
  const [isCursorInside, setIsCursorInside] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [clickBurst, setClickBurst] = useState(0);
  const center = (voiceGridSize - 1) / 2;
  const activeRadius = 1.1 + voiceLevel * 5.4;
  const haloRadius = activeRadius + 1.8;
  const scanTrail = useMemo(() => {
    const trail = new Map<number, number>();

    if (state !== "connecting" || signalPath.length === 0) {
      return trail;
    }

    let previousCoordinate: GridCoordinate | null = null;

    for (let offset = 0; offset < 10; offset += 1) {
      const coordinate = signalPath[(signalStep - offset + signalPath.length) % signalPath.length];

      if (!coordinate || coordinate.x < 0 || coordinate.y < 0) {
        break;
      }

      if (previousCoordinate && Math.hypot(coordinate.x - previousCoordinate.x, coordinate.y - previousCoordinate.y) > 1.5) {
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

    const cursorX = ((event.clientX - rect.left) / rect.width) * 100;
    const cursorY = ((event.clientY - rect.top) / rect.height) * 100;
    const isInsideGrid =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;

    if (!isInsideGrid) {
      setPointerCoordinate(null);
      setIsCursorInside(false);
      return false;
    }

    const x = Math.max(0, Math.min(voiceGridSize - 1, Math.floor(((event.clientX - rect.left) / rect.width) * voiceGridSize)));
    const y = Math.max(0, Math.min(voiceGridSize - 1, Math.floor(((event.clientY - rect.top) / rect.height) * voiceGridSize)));
    setPointerCoordinate({ x, y });
    setCursorPosition({ x: cursorX, y: cursorY });
    setIsCursorInside(true);

    return true;
  }

  function handleSquareClick() {
    setClickBurst((currentBurst) => currentBurst + 1);
    onToggle();
  }

  const shouldShowConnectionPulse = connecting || clickBurst > 0;

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
        >
          <span className="absolute left-1/2 top-1/2 grid -translate-x-1/2 -translate-y-1/2 gap-[7px] [mask-image:radial-gradient(ellipse_at_center,black_0%,black_50%,transparent_86%)]">
            <span
              className="grid gap-x-[6px] gap-y-[7px]"
              style={{ gridTemplateColumns: `repeat(${ambientPixelColumns}, 2px)` }}
            >
              {ambientPixels.map((pixel, index) => (
                <span
                  key={index}
                  className={cn(
                    "size-0.5 bg-white",
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
          data-voice-square="true"
          aria-pressed={active}
          aria-label={active ? "End voice conversation" : "Start voice conversation"}
          className={cn(
            "group/signal relative cursor-pointer rounded-lg bg-[#030303] p-0 outline-none transition-[box-shadow] duration-200",
            "focus-visible:ring-3 focus-visible:ring-cyan-300/35",
            active || connecting
              ? "shadow-[0_0_0_1px_rgba(31,213,249,0.28),0_0_30px_rgba(31,213,249,0.12)]"
              : "shadow-none",
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
              setIsCursorInside(false);
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
            setIsCursorInside(false);

            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onMouseEnter={updatePointerCoordinate}
          onMouseLeave={() => {
            if (!isDragging) {
              setPointerCoordinate(null);
              setIsCursorInside(false);
            }
          }}
          onMouseMove={updatePointerCoordinate}
        >
          <ShimmerBorder enabled />
          {shouldShowConnectionPulse ? (
            <span
              key={connecting ? "connecting" : clickBurst}
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute -inset-2 z-20 rounded-[10px] border border-transparent",
                connecting
                  ? "animate-[lk-square-side-flash_2s_ease-in-out_infinite]"
                  : "animate-[lk-square-side-flash_2s_ease-out_1]",
              )}
            />
          ) : null}
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-[1.5px] z-0 rounded-[6.5px] opacity-0 transition-opacity duration-150",
              isCursorInside && "opacity-100",
              isDragging && "duration-75",
            )}
            style={
              {
                "--lk-cursor-x": `${cursorPosition?.x ?? 50}%`,
                "--lk-cursor-y": `${cursorPosition?.y ?? 50}%`,
                background:
                  "radial-gradient(circle at var(--lk-cursor-x) var(--lk-cursor-y), rgba(255,255,255,0.12) 0%, rgba(31,213,249,0.1) 14%, transparent 42%)",
              } as CSSProperties
            }
          />
          <span
            ref={gridRef}
            aria-hidden="true"
            className="relative z-10 m-4 grid aspect-square gap-[10px] sm:m-5 sm:gap-[14px]"
            style={{ gridTemplateColumns: `repeat(${voiceGridSize}, 1fr)` }}
          >
            {voiceGridItems.map((index) => {
              const x = index % voiceGridSize;
              const y = Math.floor(index / voiceGridSize);
              const snakeOrder = x % 2 === 0 ? x * voiceGridSize + y : x * voiceGridSize + (voiceGridSize - 1 - y);
              const snakeDuration = 28;
              const distanceFromCenter = Math.hypot(x - center, y - center);
              const scanIntensity = scanTrail.get(index) ?? 0;
              const pointerDistance =
                pointerCoordinate === null ? Number.POSITIVE_INFINITY : Math.hypot(x - pointerCoordinate.x, y - pointerCoordinate.y);
              const pointerIntensity =
                pointerCoordinate === null
                  ? 0
                  : Math.max(0, Math.min(1, ((isDragging ? 4.6 : 3.1) - pointerDistance) / (isDragging ? 4.6 : 3.1)));
              const voiceIntensity =
                active && !connecting
                  ? Math.max(0, Math.min(1, (haloRadius - distanceFromCenter) / Math.max(haloRadius, 1)))
                  : 0;
              const totalIntensity = Math.max(scanIntensity, voiceIntensity, pointerIntensity);
              const isScanning = scanIntensity > 0;
              const isVoiceLit = voiceIntensity > 0.08;
              const isPointerLit = pointerIntensity > 0.05;
              const scale = totalIntensity > 0 ? 1 + totalIntensity * (isDragging ? 1.45 : 0.9) : undefined;

              return (
                <span
                  key={index}
                  data-lk-index={index}
                  data-lk-highlighted={isScanning || isVoiceLit || isPointerLit}
                  className={cn(
                    "size-1 rounded-none bg-white/[0.11] transition-all ease-out group-hover/signal:bg-white/[0.22] group-hover/signal:shadow-[0px_0px_8px_1px_rgba(255,255,255,0.12)] group-active:scale-125 sm:size-[4.5px]",
                    state === "connecting" &&
                      "animate-[lk-square-snake_var(--lk-snake-duration)_linear_var(--lk-snake-delay)_infinite]",
                    isScanning &&
                      "scale-125 bg-[#1fd5f9] shadow-[0px_0px_6.8px_2px_rgba(31,213,249,0.2)]",
                    isVoiceLit && "bg-[#1fd5f9] shadow-[0px_0px_8px_2px_rgba(31,213,249,0.18)]",
                    isPointerLit && "bg-white shadow-[0px_0px_8px_2px_rgba(255,255,255,0.16)]",
                  )}
                  style={
                    {
                      transform: scale ? `scale(${scale})` : undefined,
                      "--lk-snake-delay": `${-(snakeOrder / voiceGridItems.length) * snakeDuration}s`,
                      "--lk-snake-duration": `${snakeDuration}s`,
                      transitionProperty: "all",
                      transitionDuration: `${isDragging ? 40 : active && !connecting ? 70 : 160}ms`,
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
  const liveKitRoomRef = useRef<Room | null>(null);
  const micAnalyserRef = useRef<AudioAnalyserHandle | null>(null);
  const micAnalyserFrameRef = useRef<number | null>(null);
  const micLevelRef = useRef(0);
  const remoteAudioElementsRef = useRef<HTMLMediaElement[]>([]);
  const attachedAudioTrackIdsRef = useRef<Set<string>>(new Set());
  const conversationRef = useRef<ConversationMessage[]>([]);
  const spokenInputRef = useRef("");
  const fileNameRef = useRef("");
  const isSummarizingRef = useRef(false);
  const [fileName, setFileName] = useState("");
  const [isDatasetUploadPrompted, setIsDatasetUploadPrompted] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isConnectingVoice, setIsConnectingVoice] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [, setVoiceResponse] = useState("");
  const hasDataInput = fileName.length > 0;
  const shouldShowDatasetUpload = isDatasetUploadPrompted || hasDataInput;
  const tokenMutation = api.livekit.createToken.useMutation();
  const summarizeMutation = api.conversation.summarize.useMutation();

  function handleFiles(fileList: FileList | null) {
    const file = fileList?.[0];

    if (file) {
      fileNameRef.current = file.name;
      setFileName(file.name);
      setIsDatasetUploadPrompted(true);

      window.sessionStorage.setItem(
        "f1-agent-attached-dataset",
        JSON.stringify({
          lastModified: file.lastModified,
          name: file.name,
          size: file.size,
          type: file.type || "unknown",
        }),
      );
    }
  }

  function showDatasetUploadPrompt() {
    setIsDatasetUploadPrompted(true);
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

        if (Math.abs(smoothedLevel - micLevelRef.current) > 0.015 || smoothedLevel < 0.01) {
          micLevelRef.current = smoothedLevel;
          setMicLevel(smoothedLevel < 0.01 ? 0 : smoothedLevel);
        } else {
          micLevelRef.current = smoothedLevel;
        }

        micAnalyserFrameRef.current = window.requestAnimationFrame(readMicLevel);
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
      void room?.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
      room?.disconnect();

      if (responseTimerRef.current) {
        window.clearTimeout(responseTimerRef.current);
      }

      if (agentWaitTimerRef.current) {
        window.clearTimeout(agentWaitTimerRef.current);
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

      const handleLocalTrackPublished = (publication: { kind?: Track.Kind }) => {
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
    clearVoiceResponse();
    clearAgentWaitTimer();
    stopMicAnalyser();
    detachRemoteAudio();

    if (!room) {
      return;
    }

    await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
    room.disconnect();
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
    remoteAudioElementsRef.current = [...remoteAudioElementsRef.current, element];

    void liveKitRoomRef.current
      ?.startAudio()
      .then(() => element.play())
      .catch(() => {
        showTemporaryResponse("Audio is blocked. Click the voice button again to resume playback.");
      });
  }

  function handleTrackUnsubscribed(track: RemoteTrack) {
    attachedAudioTrackIdsRef.current.delete(track.sid ?? track.mediaStreamTrack.id);
    track.detach().forEach((element) => {
      element.remove();
      remoteAudioElementsRef.current = remoteAudioElementsRef.current.filter((audio) => audio !== element);
    });
  }

  function handleTranscriptText(identity: string, text: string, isFinal: boolean) {
    const transcript = text.trim();

    if (transcript.length === 0) {
      return;
    }

    const role = getRoleFromIdentity(identity);

    setVoiceResponse(`${getDisplaySpeaker(role)}: ${transcript}`);

    if (!isFinal) {
      return;
    }

    const currentConversation = conversationRef.current;
    const lastMessage = currentConversation.at(-1);

    if (!(lastMessage?.role === role && lastMessage.content === transcript)) {
      conversationRef.current = [...currentConversation, { role, content: transcript }];
    }

    if (role === "user") {
      spokenInputRef.current = transcript;

      if (mentionsCustomDataset(transcript)) {
        showDatasetUploadPrompt();
      }
    }
  }

  async function handleCustomDatasetUploadStream(reader: AsyncIterable<string>) {
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

    await continueToAgents();
  }

  async function handleTranscriptionStream(
    reader: AsyncIterable<string> & { info: { attributes?: Record<string, string> } },
    identity: string,
  ) {
    const isFinal = reader.info.attributes?.[TRANSCRIPTION_FINAL_ATTRIBUTE] === "true";
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
      room.registerTextStreamHandler(TRANSCRIPTION_TOPIC, (reader, participantInfo) => {
        void handleTranscriptionStream(reader, participantInfo.identity).catch(() => {
          showTemporaryResponse("Could not read the LiveKit transcript stream.");
        });
      });
      room.registerTextStreamHandler(CUSTOM_DATASET_UPLOAD_TOPIC, (reader) => {
        void handleCustomDatasetUploadStream(reader).catch(() => {
          showDatasetUploadPrompt();
        });
      });
      room.registerTextStreamHandler(START_AGENT_WORK_TOPIC, (reader) => {
        void handleStartAgentWorkStream(reader).catch((error) => {
          showTemporaryResponse(error instanceof Error ? error.message : "Could not start agent work.");
        });
      });

      room.on(RoomEvent.ParticipantConnected, (participant) => {
        if (!participant.identity.startsWith("speaker-")) {
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
        showTemporaryResponse("Your mic is connected, but LiveKit detects silence. Check the input device.");
      });
      room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
        if (!room.canPlaybackAudio) {
          showTemporaryResponse("Audio is blocked. Click the voice button again to resume playback.");
          return;
        }

        void Promise.all(remoteAudioElementsRef.current.map((element) => element.play().catch(() => undefined)));
      });
      room.on(RoomEvent.Disconnected, () => {
        liveKitRoomRef.current = null;
        setIsListening(false);
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
      const microphonePublication = await room.localParticipant.setMicrophoneEnabled(true, {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
      startMicAnalyser(microphonePublication?.audioTrack);
      await microphoneReady;

      if (!Array.from(room.remoteParticipants.values()).some((participant) => !participant.identity.startsWith("speaker-"))) {
        agentWaitTimerRef.current = window.setTimeout(() => {
          showTemporaryResponse("Mic connected, but the voice agent has not joined. Check the dev terminal.", 9000);
        }, 8000);
      }

      room.remoteParticipants.forEach((participant) => {
        if (!participant.identity.startsWith("speaker-")) {
          clearAgentWaitTimer();
          showTemporaryResponse("Voice agent connected. Speak now.", 2600);
        }

        participant.trackPublications.forEach((publication) => {
          subscribeAudioPublication(publication, participant);
        });
      });
      showTemporaryResponse("Mic connected. Waiting for speech...", 3000);
    } finally {
      setIsConnectingVoice(false);
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
      clearAgentWaitTimer();
      showTemporaryResponse(error instanceof Error ? error.message : "Could not connect LiveKit.");
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
      void room?.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
      room?.disconnect();
    }

    window.addEventListener("keydown", handleEscapeKey);

    return () => window.removeEventListener("keydown", handleEscapeKey);
  }, [isListening]);

  async function continueToAgents() {
    if (isSummarizingRef.current) {
      return;
    }

    await stopLiveKitRoom();
    isSummarizingRef.current = true;

    try {
      const latestConversation = conversationRef.current;
      const latestSpokenIntent = spokenInputRef.current.trim();
      const latestFileName = fileNameRef.current;
      const summaryMessages =
        latestConversation.length > 0
          ? latestConversation
          : [
              {
                role: "user" as const,
                content: latestSpokenIntent || "The user asked Bron to start working.",
              },
            ];
      const dataContextMessages = latestFileName.length > 0
        ? [
            {
              role: "user" as const,
              content: `Attached custom dataset file: ${latestFileName}. Use this as source data context.`,
            },
          ]
        : [];
      const { summary } = await summarizeMutation.mutateAsync({
        messages: [...summaryMessages, ...dataContextMessages],
      });

      window.sessionStorage.setItem("f1-agent-conversation-summary", summary);
      router.push("/agents", {
        scroll: false,
        transitionTypes: ["nav-forward"],
      });
    } catch (error) {
      showTemporaryResponse(error instanceof Error ? error.message : "Could not summarize conversation.");
      isSummarizingRef.current = false;
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
          maskImage: "radial-gradient(circle at center, black 0%, black 54%, transparent 100%)",
        }}
      />

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
          onClick={() => router.push("/agents")}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-white/12 bg-white/[0.035] px-4 text-sm font-medium text-white/76 transition hover:border-white/24 hover:bg-white/[0.065] hover:text-white"
        >
          <LayoutDashboard className="size-4" strokeWidth={1.8} />
          Dashboard
        </button>
      </header>

      <section className="relative z-10 grid min-h-[calc(100vh-5rem)] place-items-center pb-24 pt-2">
        <div className="flex w-[calc(100vw-2.5rem)] max-w-[46rem] flex-col items-center">
          <div className="relative grid w-full place-items-center">
            <VoiceSignalSquare
              active={isListening}
              connecting={isConnectingVoice}
              voiceLevel={micLevel}
              onToggle={startSpeechInput}
            />

            <div
              className={cn(
                "absolute left-1/2 top-[calc(50%+7.35rem)] z-0 -translate-x-1/2 transition-all duration-300 ease-out sm:top-[calc(50%+8.15rem)]",
                shouldShowDatasetUpload
                  ? "translate-y-0 opacity-100"
                  : "pointer-events-none -translate-y-12 opacity-0",
              )}
            >
              {shouldShowDatasetUpload ? (
                <label
                  data-dataset-upload="true"
                  aria-label="Upload data"
                  className={cn(
                    "grid size-12 shrink-0 cursor-pointer place-items-center rounded-md border border-cyan-300/55 bg-cyan-300/[0.13] text-cyan-50 shadow-[0_0_38px_rgba(34,211,238,0.24),inset_0_1px_0_rgba(255,255,255,0.14)] transition hover:border-cyan-200/75 hover:bg-cyan-300/[0.18] focus-within:ring-3 focus-within:ring-cyan-300/30",
                    hasDataInput
                      ? "animate-none border-emerald-300/55 bg-emerald-300/[0.12] text-emerald-50 shadow-[0_0_38px_rgba(110,231,183,0.2),inset_0_1px_0_rgba(255,255,255,0.14)]"
                      : "animate-pulse",
                  )}
                >
                  <Paperclip className="size-5" strokeWidth={1.8} />
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="sr-only"
                    onChange={(event) => handleFiles(event.target.files)}
                  />
                </label>
              ) : null}
            </div>
          </div>

        </div>
      </section>
    </main>
  );
}
