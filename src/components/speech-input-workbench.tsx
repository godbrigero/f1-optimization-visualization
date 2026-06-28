"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, Upload } from "lucide-react";
import {
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteParticipant,
  type RemoteTrackPublication,
  type RemoteAudioTrack,
  type RemoteTrack,
  type TranscriptionSegment,
} from "livekit-client";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";

const acceptedFileTypes = ".csv,.json,.txt,.xlsx,.xls,.tsv";
const VOICE_ROOM = "f1-model-conversation";

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

function getParticipantRole(participant?: Participant): ConversationMessage["role"] {
  return participant?.identity.startsWith("speaker-") ? "user" : "assistant";
}

function getDisplaySpeaker(role: ConversationMessage["role"]) {
  return role === "user" ? "You" : "Agent";
}

export function SpeechInputWorkbench() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const responseTimerRef = useRef<number | null>(null);
  const liveKitRoomRef = useRef<Room | null>(null);
  const remoteAudioElementsRef = useRef<HTMLMediaElement[]>([]);
  const attachedAudioTrackIdsRef = useRef<Set<string>>(new Set());
  const [fileName, setFileName] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isConnectingVoice, setIsConnectingVoice] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [spokenInput, setSpokenInput] = useState("");
  const [voiceResponse, setVoiceResponse] = useState("");
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [debugUnlocked, setDebugUnlocked] = useState(false);
  const hasSpeechInput = spokenInput.trim().split(/\s+/).filter(Boolean).length > 0;
  const hasDataInput = fileName.length > 0;
  const canContinue = ((hasSpeechInput && hasDataInput) || debugUnlocked) && !isSummarizing;
  const showVoiceResponse = isConnectingVoice || isListening || voiceResponse.length > 0;
  const tokenMutation = api.livekit.createToken.useMutation();
  const summarizeMutation = api.conversation.summarize.useMutation();

  useEffect(() => {
    router.prefetch("/agents");

    return () => {
      const room = liveKitRoomRef.current;
      liveKitRoomRef.current = null;
      remoteAudioElementsRef.current.forEach((element) => element.remove());
      remoteAudioElementsRef.current = [];
      void room?.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
      room?.disconnect();

      if (responseTimerRef.current) {
        window.clearTimeout(responseTimerRef.current);
      }
    };
  }, [router]);

  function handleFiles(fileList: FileList | null) {
    const file = fileList?.[0];

    if (file) {
      setFileName(file.name);
    }
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

  function detachRemoteAudio() {
    remoteAudioElementsRef.current.forEach((element) => element.remove());
    remoteAudioElementsRef.current = [];
    attachedAudioTrackIdsRef.current.clear();
  }

  async function stopLiveKitRoom() {
    const room = liveKitRoomRef.current;
    liveKitRoomRef.current = null;
    setIsListening(false);
    clearVoiceResponse();
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
      .then(() => {
        showTemporaryResponse("Bron audio connected.", 2200);
      })
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

  function handleTranscription(segments: TranscriptionSegment[], participant?: Participant) {
    const role = getParticipantRole(participant);
    const readableSegments = segments
      .map((segment) => segment.text.trim())
      .filter(Boolean);

    if (readableSegments.length === 0) {
      return;
    }

    const text = readableSegments.join(" ").trim();
    const isFinal = segments.some((segment) => segment.final);

    setVoiceResponse(`${getDisplaySpeaker(role)}: ${text}`);

    if (!isFinal) {
      return;
    }

    setConversation((currentConversation) => {
      const lastMessage = currentConversation.at(-1);

      if (lastMessage?.role === role && lastMessage.content === text) {
        return currentConversation;
      }

      return [...currentConversation, { role, content: text }];
    });

    if (role === "user") {
      setSpokenInput(text);
    }

    showTemporaryResponse(`${getDisplaySpeaker(role)}: ${text}`);
  }

  async function startLiveKitRoom() {
    if (liveKitRoomRef.current) {
      return;
    }

    setIsConnectingVoice(true);

    try {
      const identity = createIdentity();
      const { token, url } = await tokenMutation.mutateAsync({
        identity,
        room: VOICE_ROOM,
        name: "Driver",
        metadata: JSON.stringify({ feature: "livekit-model-conversation" }),
        canPublish: true,
        canSubscribe: true,
      });
      const room = new Room();

      room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
      room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
      room.on(RoomEvent.TranscriptionReceived, handleTranscription);
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
        detachRemoteAudio();
      });

      liveKitRoomRef.current = room;
      await room.connect(url, token);
      await room.startAudio();
      await room.localParticipant.setMicrophoneEnabled(true);
      room.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((publication) => {
          if (publication.track && publication.kind === Track.Kind.Audio) {
            handleTrackSubscribed(publication.track, publication, participant);
          }
        });
      });
      setIsListening(true);
      showTemporaryResponse("Connected. Start talking.", 2600);
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
      showTemporaryResponse(error instanceof Error ? error.message : "Could not connect LiveKit.");
    }
  }

  async function continueToAgents() {
    if (!canContinue) {
      return;
    }

    await stopLiveKitRoom();
    setIsSummarizing(true);

    try {
      const summaryMessages =
        conversation.length > 0
          ? conversation
          : spokenInput
            ? [{ role: "user" as const, content: spokenInput }]
            : [{ role: "user" as const, content: "Debug-unlocked conversation without captured speech." }];
      const { summary } = await summarizeMutation.mutateAsync({
        messages: summaryMessages,
      });

      window.sessionStorage.setItem("f1-agent-conversation-summary", summary);
      router.push("/agents", {
        scroll: false,
        transitionTypes: ["nav-forward"],
      });
    } catch (error) {
      showTemporaryResponse(error instanceof Error ? error.message : "Could not summarize conversation.");
      setIsSummarizing(false);
    }
  }

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#030303] px-5 text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 opacity-100 transition-opacity duration-300"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
          backgroundSize: "42px 42px, 42px 42px",
          maskImage: "radial-gradient(circle at center, black 0%, black 58%, transparent 100%)",
        }}
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-[100px] z-0 flex flex-col items-center">
        <div className="font-sans text-[7.8rem] font-black uppercase leading-[0.78] tracking-[0.22em] text-[#262626] sm:text-[10.8rem] lg:text-[13rem]">
          Bron
        </div>
        <div className="mt-5 h-px w-[min(58vw,760px)] bg-gradient-to-r from-transparent via-white/[0.12] to-transparent" />
        <p className="mt-5 max-w-2xl text-center text-lg font-medium leading-8 text-white/44">
          Solve hard problems with Bron. Talk, upload data, and get the best agent pipeline.
        </p>
      </div>

      <section className="relative z-10 mt-[20rem] flex w-full flex-col items-center">
        <div className="flex w-full max-w-4xl flex-col items-center">
          <button
            type="button"
            onClick={startSpeechInput}
            aria-pressed={isListening}
            aria-label={isListening ? "Stop voice session" : "Start voice session"}
            className={cn(
              "group relative flex h-20 cursor-pointer items-center gap-5 rounded-full border bg-[#080808] px-5 pr-6 text-white shadow-[0_18px_55px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.055)] outline-none transition duration-300 hover:-translate-y-0.5 hover:bg-white/[0.04] focus-visible:ring-3 focus-visible:ring-white/15",
              hasSpeechInput
                ? "border-emerald-400/35 bg-emerald-400/[0.035] shadow-[0_22px_70px_rgba(16,185,129,0.08),inset_0_1px_0_rgba(255,255,255,0.1)] hover:border-emerald-300/45"
                : "border-white/14 bg-white/[0.025] hover:border-white/24",
            )}
          >
          <span
            className={cn(
              "grid size-12 place-items-center rounded-full border border-white/10 bg-white/[0.035] text-white/78 transition group-hover:border-white/18 group-hover:text-white",
              isListening && "border-white/28 bg-white/[0.08] text-white shadow-[0_0_28px_rgba(255,255,255,0.1)]",
              hasSpeechInput && "border-emerald-300/24 bg-emerald-300/[0.075] text-white",
              !hasSpeechInput && "border-white/12 bg-white/[0.035]",
            )}
          >
            <Mic className="size-6" strokeWidth={2.05} />
          </span>

          <span className="flex min-w-40 flex-col items-start">
            <span className="text-lg font-medium leading-none">
              {isListening ? "Live conversation" : hasSpeechInput ? "Voice captured" : "Talk to agent"}
            </span>
            <span className="mt-2 text-sm leading-none text-white/42">
              {isConnectingVoice
                ? "Connecting LiveKit"
                : isListening
                  ? "Streaming room audio"
                  : hasSpeechInput
                    ? "Speech input complete"
                    : "Say at least one word"}
            </span>
          </span>

          <span className="flex h-10 items-center gap-1.5 rounded-full border border-white/[0.07] bg-black/35 px-4">
            {[12, 19, 15, 24, 14, 20, 11].map((height, index) => (
              <span
                key={`${height}-${index}`}
                className={cn(
                  "w-1 rounded-full bg-white/35 motion-safe:animate-pulse",
                  isListening && "bg-white/75",
                  hasSpeechInput && !isListening && "bg-emerald-200/65",
                  !hasSpeechInput && !isListening && "bg-white/35",
                )}
                style={{
                  height,
                  animationDelay: `${index * 110}ms`,
                  animationDuration: isListening ? "760ms" : "1700ms",
                }}
              />
            ))}
          </span>
          </button>

          <div
            className={cn(
              "grid w-full place-items-center overflow-hidden transition-[grid-template-rows,opacity,margin] duration-300 ease-out",
              showVoiceResponse ? "mt-5 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0",
            )}
          >
            <p aria-live="polite" className="min-h-0 max-w-md overflow-hidden text-center text-sm text-white/38">
              {voiceResponse || "Listening..."}
            </p>
          </div>

          <label
            className={cn(
              "flex h-20 w-full max-w-3xl cursor-pointer items-center gap-5 rounded-xl border bg-white/[0.035] px-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] transition-all duration-300 ease-out hover:bg-white/[0.055]",
              showVoiceResponse ? "mt-8" : "mt-9",
              hasDataInput
                ? "border-emerald-400/35 bg-emerald-400/[0.025] hover:border-emerald-300/45"
                : "border-white/14 bg-white/[0.025] hover:border-white/24",
            )}
          >
          <Upload
            className={cn(
              "size-6 shrink-0 text-white/58",
              hasDataInput ? "text-emerald-200/72" : "text-white/52",
            )}
            strokeWidth={1.8}
          />
          <span className="min-w-0 flex-1 truncate text-xl text-white/58">{fileName || "Upload data"}</span>
          <span className="shrink-0 text-xl font-medium text-white/90">Browse</span>
          <input
            ref={fileInputRef}
            type="file"
            accept={acceptedFileTypes}
            className="sr-only"
            onChange={(event) => handleFiles(event.target.files)}
          />
          </label>
        </div>
      </section>

      {process.env.NODE_ENV !== "production" ? (
        <button
          type="button"
          onClick={() => setDebugUnlocked((isUnlocked) => !isUnlocked)}
          className={cn(
            "fixed bottom-8 left-8 rounded-md border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] transition",
            debugUnlocked
              ? "border-amber-300/36 bg-amber-300/[0.08] text-amber-100"
              : "border-white/10 bg-white/[0.035] text-white/42 hover:border-white/22 hover:text-white/72",
          )}
        >
          Debug unlock
        </button>
      ) : null}

      <div
        className={cn(
          "fixed bottom-8 left-0 right-0 flex justify-center px-5 transition-all duration-300",
          canContinue ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-5 opacity-0",
        )}
      >
        <button
          type="button"
          onClick={continueToAgents}
          disabled={!canContinue}
          className="h-11 rounded-md border border-white/14 bg-[#0b0b0b] px-9 text-sm font-medium text-white/90 shadow-[0_18px_48px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(255,255,255,0.055)] transition hover:-translate-y-px hover:border-white/26 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-white/15 disabled:cursor-default"
        >
          {isSummarizing ? "Summarizing..." : "Continue"}
        </button>
      </div>
    </main>
  );
}
