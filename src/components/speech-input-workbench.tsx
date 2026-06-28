"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, Upload } from "lucide-react";
import { Room } from "livekit-client";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";

const acceptedFileTypes = ".csv,.json,.txt,.xlsx,.xls,.tsv";

type SpeechRecognitionEvent = Event & {
  results: SpeechRecognitionResultList;
  resultIndex: number;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

const VOICE_ROOM = "f1-model-conversation";

function createIdentity() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `speaker-${crypto.randomUUID()}`;
  }

  return `speaker-${Date.now()}`;
}

export function SpeechInputWorkbench() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const responseTimerRef = useRef<number | null>(null);
  const liveKitRoomRef = useRef<Room | null>(null);
  const responseAudioRef = useRef<HTMLAudioElement | null>(null);
  const [fileName, setFileName] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isConnectingVoice, setIsConnectingVoice] = useState(false);
  const [isAgentThinking, setIsAgentThinking] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [spokenInput, setSpokenInput] = useState("");
  const [voiceResponse, setVoiceResponse] = useState("");
  const [agentResponse, setAgentResponse] = useState("");
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [debugUnlocked, setDebugUnlocked] = useState(false);
  const hasSpeechInput = spokenInput.trim().split(/\s+/).filter(Boolean).length > 0;
  const hasDataInput = fileName.length > 0;
  const canContinue = ((hasSpeechInput && hasDataInput) || debugUnlocked) && !isSummarizing;
  const showVoiceResponse =
    isConnectingVoice || isListening || isAgentThinking || voiceResponse.length > 0 || agentResponse.length > 0;
  const tokenMutation = api.livekit.createToken.useMutation();
  const respondMutation = api.conversation.respond.useMutation();
  const summarizeMutation = api.conversation.summarize.useMutation();
  const speakMutation = api.conversation.speak.useMutation();

  useEffect(() => {
    router.prefetch("/agents");

    return () => {
      recognitionRef.current?.stop();
      liveKitRoomRef.current?.disconnect();
      responseAudioRef.current?.pause();

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

  function showTemporaryResponse(message: string) {
    setVoiceResponse(message);

    if (responseTimerRef.current) {
      window.clearTimeout(responseTimerRef.current);
    }

    responseTimerRef.current = window.setTimeout(() => {
      setVoiceResponse("");
    }, 4200);
  }

  function clearVoiceResponse() {
    setVoiceResponse("");

    if (responseTimerRef.current) {
      window.clearTimeout(responseTimerRef.current);
      responseTimerRef.current = null;
    }
  }

  async function stopLiveKitRoom() {
    const room = liveKitRoomRef.current;
    liveKitRoomRef.current = null;

    if (!room) {
      return;
    }

    await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
    room.disconnect();
  }

  async function playModelVoice(response: string) {
    responseAudioRef.current?.pause();
    responseAudioRef.current = null;

    try {
      const { audioBase64, mimeType } = await speakMutation.mutateAsync({
        input: response,
      });
      const audio = new Audio(`data:${mimeType};base64,${audioBase64}`);

      responseAudioRef.current = audio;
      await audio.play();
    } catch {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(response));
      }
    }
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
        name: "Model conversation",
        metadata: JSON.stringify({ feature: "digitalocean-model-conversation" }),
        canPublish: true,
        canSubscribe: true,
      });
      const room = new Room();

      liveKitRoomRef.current = room;
      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true);
    } finally {
      setIsConnectingVoice(false);
    }
  }

  async function sendTranscriptToModel(transcript: string) {
    const userMessage: ConversationMessage = {
      role: "user",
      content: transcript,
    };
    const nextConversation = [...conversation, userMessage];

    setConversation(nextConversation);
    setIsAgentThinking(true);
    setAgentResponse("");

    try {
      const { response } = await respondMutation.mutateAsync({
        messages: nextConversation,
      });
      const assistantMessage: ConversationMessage = {
        role: "assistant",
        content: response,
      };

      setConversation([...nextConversation, assistantMessage]);
      setAgentResponse(response);
      await playModelVoice(response);
    } catch (error) {
      setAgentResponse(error instanceof Error ? error.message : "The model did not respond.");
    } finally {
      setIsAgentThinking(false);
    }
  }

  async function startSpeechInput() {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      clearVoiceResponse();
      await stopLiveKitRoom();
      return;
    }

    const SpeechRecognition =
      (window as typeof window & {
        SpeechRecognition?: SpeechRecognitionConstructor;
        webkitSpeechRecognition?: SpeechRecognitionConstructor;
      }).SpeechRecognition ??
      (window as typeof window & {
        SpeechRecognition?: SpeechRecognitionConstructor;
        webkitSpeechRecognition?: SpeechRecognitionConstructor;
      }).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      showTemporaryResponse("Speech input is not supported in this browser.");
      return;
    }

    try {
      await startLiveKitRoom();
    } catch (error) {
      showTemporaryResponse(error instanceof Error ? error.message : "Could not connect LiveKit.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      let transcript = "";
      let isFinal = false;

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const phrase = result[0]?.transcript.trim();

        if (phrase) {
          transcript = `${transcript} ${phrase}`.trim();
        }

        if (result.isFinal) {
          isFinal = true;
        }
      }

      if (transcript) {
        setVoiceResponse(transcript);

        if (isFinal) {
          setSpokenInput(transcript);
          showTemporaryResponse(transcript);
          void sendTranscriptToModel(transcript);
        }
      }
    };

    recognition.onerror = () => {
      setIsListening(false);
      showTemporaryResponse("I could not hear that. Try again.");
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    setIsListening(true);
    showTemporaryResponse("Listening through LiveKit...");
    recognition.start();
  }

  async function continueToAgents() {
    if (!canContinue) {
      return;
    }

    recognitionRef.current?.stop();
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
      <section className="flex w-full max-w-2xl flex-col items-center">
        <button
          type="button"
          onClick={startSpeechInput}
          aria-pressed={isListening}
          aria-label={isListening ? "Stop speech input" : "Start speech input"}
          className={cn(
            "group relative flex h-16 cursor-pointer items-center gap-4 rounded-full border bg-[#080808] px-4 pr-5 text-white shadow-[0_18px_55px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.055)] outline-none transition duration-300 hover:-translate-y-0.5 hover:bg-white/[0.04] focus-visible:ring-3 focus-visible:ring-white/15",
            hasSpeechInput
              ? "border-emerald-400/35 bg-emerald-400/[0.035] shadow-[0_22px_70px_rgba(16,185,129,0.08),inset_0_1px_0_rgba(255,255,255,0.1)] hover:border-emerald-300/45"
              : "border-red-400/32 bg-red-500/[0.025] hover:border-red-300/42",
          )}
        >
          <span
            className={cn(
              "grid size-10 place-items-center rounded-full border border-white/10 bg-white/[0.035] text-white/78 transition group-hover:border-white/18 group-hover:text-white",
              hasSpeechInput && "border-emerald-300/24 bg-emerald-300/[0.075] text-white",
              !hasSpeechInput && "border-red-300/18 bg-red-300/[0.045]",
            )}
          >
            <Mic className="size-5" strokeWidth={2.05} />
          </span>

          <span className="flex min-w-32 flex-col items-start">
            <span className="text-sm font-medium leading-none">
              {isListening ? "Listening" : hasSpeechInput ? "Voice captured" : "Talk to agent"}
            </span>
            <span className="mt-1.5 text-[11px] leading-none text-white/42">
              {isConnectingVoice
                ? "Connecting LiveKit"
                : hasSpeechInput
                  ? "Speech input complete"
                  : "Say at least one word"}
            </span>
          </span>

          <span className="flex h-8 items-center gap-1 rounded-full border border-white/[0.07] bg-black/35 px-3">
            {[12, 19, 15, 24, 14, 20, 11].map((height, index) => (
              <span
                key={`${height}-${index}`}
                className={cn(
                  "w-1 rounded-full bg-white/35 motion-safe:animate-pulse",
                  isListening && "bg-white/75",
                  hasSpeechInput && !isListening && "bg-emerald-200/65",
                  !hasSpeechInput && !isListening && "bg-red-200/45",
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
            showVoiceResponse
              ? "mt-5 grid-rows-[1fr] opacity-100"
              : "mt-0 grid-rows-[0fr] opacity-0",
          )}
        >
          <p
            aria-live="polite"
            className="min-h-0 max-w-md overflow-hidden text-center text-sm text-white/38"
          >
            {isAgentThinking
              ? "Model is thinking..."
              : agentResponse
                ? `Model: ${agentResponse}`
                : voiceResponse || "Listening..."}
          </p>
        </div>

        <label
          className={cn(
            "flex h-16 w-full cursor-pointer items-center gap-4 rounded-xl border bg-white/[0.035] px-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] transition-all duration-300 ease-out hover:bg-white/[0.055]",
            showVoiceResponse ? "mt-8" : "mt-9",
            hasDataInput
              ? "border-emerald-400/35 bg-emerald-400/[0.025] hover:border-emerald-300/45"
              : "border-red-400/32 bg-red-500/[0.02] hover:border-red-300/42",
          )}
        >
          <Upload
            className={cn(
              "size-5 shrink-0 text-white/58",
              hasDataInput ? "text-emerald-200/72" : "text-red-200/58",
            )}
            strokeWidth={1.8}
          />
          <span className="min-w-0 flex-1 truncate text-base text-white/58">
            {fileName || "Upload data"}
          </span>
          <span className="shrink-0 text-base font-medium text-white/90">Browse</span>
          <input
            ref={fileInputRef}
            type="file"
            accept={acceptedFileTypes}
            className="sr-only"
            onChange={(event) => handleFiles(event.target.files)}
          />
        </label>
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
          canContinue
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-5 opacity-0",
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
