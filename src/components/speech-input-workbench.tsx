"use client";

import { useRef, useState } from "react";
import { Mic, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

const acceptedFileTypes = ".csv,.json,.txt,.xlsx,.xls,.tsv";

export function SpeechInputWorkbench() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const canContinue = voiceEnabled && fileName.length > 0;

  function handleFiles(fileList: FileList | null) {
    const file = fileList?.[0];

    if (file) {
      setFileName(file.name);
    }
  }

  function toggleVoice() {
    const nextEnabled = !voiceEnabled;

    setVoiceEnabled(nextEnabled);

    if (!("speechSynthesis" in window)) {
      return;
    }

    window.speechSynthesis.cancel();

    if (nextEnabled) {
      const utterance = new SpeechSynthesisUtterance("Text to speech is on.");
      utterance.rate = 0.95;
      window.speechSynthesis.speak(utterance);
    }
  }

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#030303] px-5 text-white">
      <section className="flex w-full max-w-2xl flex-col items-center gap-9">
        <button
          type="button"
          onClick={toggleVoice}
          aria-pressed={voiceEnabled}
          aria-label={voiceEnabled ? "Turn off text to speech" : "Turn on text to speech"}
          className={cn(
            "group relative grid size-26 cursor-pointer place-items-center rounded-full border border-white/14 bg-[#090909] text-white/90 shadow-[0_18px_55px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.055)] outline-none transition duration-300 hover:-translate-y-0.5 hover:border-white/24 hover:bg-white/[0.04] focus-visible:ring-3 focus-visible:ring-white/15",
            voiceEnabled &&
              "border-white/34 bg-white/[0.07] text-white shadow-[0_22px_70px_rgba(255,255,255,0.07),0_0_0_9px_rgba(255,255,255,0.035),inset_0_1px_0_rgba(255,255,255,0.1)]",
          )}
        >
          <span
            className={cn(
              "absolute -inset-3 rounded-full border border-white/[0.045] opacity-80 motion-safe:animate-pulse",
              voiceEnabled && "border-white/12",
            )}
          />
          <span
            className={cn(
              "absolute inset-3 rounded-full border border-white/[0.06] bg-white/[0.015]",
              voiceEnabled && "border-white/16 bg-white/[0.035]",
            )}
          />
          <span
            className={cn(
              "absolute bottom-5 h-1 w-8 rounded-full bg-white/10 transition",
              voiceEnabled && "bg-white/32 shadow-[0_0_16px_rgba(255,255,255,0.16)]",
            )}
          />
          <Mic className="relative size-9" strokeWidth={2.05} />
        </button>

        <label className="flex h-16 w-full cursor-pointer items-center gap-4 rounded-xl border border-white/12 bg-white/[0.035] px-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] transition hover:border-white/24 hover:bg-white/[0.055]">
          <Upload className="size-5 shrink-0 text-white/58" strokeWidth={1.8} />
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
          disabled={!canContinue}
          className="h-11 rounded-full border border-white/14 bg-white/[0.075] px-9 text-sm font-medium text-white shadow-[0_18px_48px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(255,255,255,0.065)] transition hover:-translate-y-px hover:border-white/28 hover:bg-white/[0.105] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-white/15 disabled:cursor-default"
        >
          Continue
        </button>
      </div>
    </main>
  );
}
