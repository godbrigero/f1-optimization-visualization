import type { Metadata } from "next";
import { SpeechInputWorkbench } from "@/components/speech-input-workbench";

export const metadata: Metadata = {
  title: "Speech Input | F1 Optimization Visualization",
  description: "Upload optimization data and draft text-to-speech instructions.",
};

export default function SpeechPage() {
  return <SpeechInputWorkbench />;
}
