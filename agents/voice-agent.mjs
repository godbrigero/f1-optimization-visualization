import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AutoSubscribe, cli, defineAgent, inference, llm, ServerOptions, voice } from "@livekit/agents";
import { LLM as OpenAILLM } from "@livekit/agents-plugin-openai";
import { z } from "zod";

const currentFile = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(currentFile), "..");

function loadEnvFile(fileName) {
  const envPath = path.join(workspaceRoot, fileName);

  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    let value = trimmedLine.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] ??= value;
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

function requiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required for the LiveKit voice agent.`);
  }

  return value;
}

function optionalNumberEnv(name, fallback) {
  const value = process.env[name];
  const parsedValue = value ? Number(value) : Number.NaN;

  return Number.isFinite(parsedValue) ? parsedValue : fallback;
}

function boundedNumberEnv(name, fallback, min, max) {
  return Math.min(max, Math.max(min, optionalNumberEnv(name, fallback)));
}

const livekitUrl = requiredEnv("LIVEKIT_URL");
const livekitApiKey = requiredEnv("LIVEKIT_API_KEY");
const livekitApiSecret = requiredEnv("LIVEKIT_API_SECRET");
const digitalOceanApiKey = requiredEnv("DIGITALOCEAN_MODEL_API_KEY");
const digitalOceanBaseUrl = process.env.DIGITALOCEAN_MODEL_BASE_URL ?? "https://inference.do-ai.run/v1";
const chatModel = process.env.DIGITALOCEAN_CHAT_MODEL ?? "qwen3-coder-flash";
const sttModel = process.env.LIVEKIT_AGENT_STT_MODEL ?? "deepgram/flux-general-en";
const ttsModel = process.env.LIVEKIT_AGENT_TTS_MODEL ?? "cartesia/sonic-3.5";
const ttsVoice = process.env.LIVEKIT_AGENT_TTS_VOICE || "a5136bf9-224c-4d76-b823-52bd5efcffcc";
const agentName = process.env.LIVEKIT_AGENT_NAME || process.env.LIVEKIT_AGENT_ID || "f1-voice-agent";
const agentId = process.env.LIVEKIT_AGENT_ID || agentName;
const CUSTOM_DATASET_UPLOAD_TOPIC = "lebronsseiur.custom_dataset_upload";
const START_AGENT_WORK_TOPIC = "lebronsseiur.start_agent_work";
const START_AGENT_WORK_PHRASE = "Ok, redirecting you to Coach Bron. Stand by for context switch.";

export default defineAgent({
  entry: async (ctx) => {
    const session = new voice.AgentSession({
      vad: new inference.VAD({
        model: "silero",
        minSpeechDuration: boundedNumberEnv("LIVEKIT_AGENT_VAD_MIN_SPEECH_MS", 45, 20, 500),
        minSilenceDuration: boundedNumberEnv("LIVEKIT_AGENT_VAD_MIN_SILENCE_MS", 95, 60, 600),
        activationThreshold: boundedNumberEnv("LIVEKIT_AGENT_VAD_ACTIVATION_THRESHOLD", 0.55, 0.2, 0.8),
      }),
      stt: new inference.STT({
        model: sttModel,
        language: "en",
        apiKey: livekitApiKey,
        apiSecret: livekitApiSecret,
        modelOptions: {
          eager_eot_threshold: boundedNumberEnv("LIVEKIT_AGENT_EAGER_EOT_THRESHOLD", 0.3, 0.1, 0.9),
          eot_timeout_ms: boundedNumberEnv("LIVEKIT_AGENT_EOT_TIMEOUT_MS", 260, 180, 60000),
          language_hint: "en",
        },
      }),
      llm: new OpenAILLM({
        apiKey: digitalOceanApiKey,
        baseURL: digitalOceanBaseUrl,
        model: chatModel,
        temperature: 0.35,
        maxCompletionTokens: optionalNumberEnv("LIVEKIT_AGENT_MAX_COMPLETION_TOKENS", 80),
      }),
      tts: new inference.TTS({
        model: ttsModel,
        voice: ttsVoice,
        apiKey: livekitApiKey,
        apiSecret: livekitApiSecret,
        modelOptions: {
          speed: process.env.LIVEKIT_AGENT_TTS_SPEED || "normal",
          max_buffer_delay_ms: boundedNumberEnv("LIVEKIT_AGENT_TTS_MAX_BUFFER_DELAY_MS", 20, 0, 1000),
        },
      }),
      aecWarmupDuration: null,
      turnHandling: {
        turnDetection: "vad",
        preemptiveGeneration: {
          enabled: true,
          preemptiveTts: true,
          maxSpeechDuration: 8000,
          maxRetries: 3,
        },
        interruption: {
          enabled: false,
        },
        endpointing: {
          minDelay: boundedNumberEnv("LIVEKIT_AGENT_ENDPOINT_MIN_DELAY_MS", 35, 20, 1000),
          maxDelay: boundedNumberEnv("LIVEKIT_AGENT_ENDPOINT_MAX_DELAY_MS", 160, 80, 5000),
        },
      },
      ttsTextTransforms: ["filter_markdown", "filter_emoji"],
    });

    const agent = new voice.Agent({
      id: agentId,
      instructions:
        `You are Bron, a fast voice agent for a problem-solving app. Speak in short, confident sentences under 18 words unless asked for detail. Ask one clear follow-up when the user is vague. Do not mention implementation details unless asked. If the user mentions having, needing, uploading, attaching, importing, or using a custom dataset or their own data file, decide that they need the custom dataset upload control. Call show_custom_dataset_upload, then say exactly: "Oh, I'll pull up the addition button below. Just press it and add your custom dataset in any format." Keep the voice conversation going after saying that. When the user clearly says they are done explaining, asks you to get to work, start, run it, build it, solve it, or proceed, call start_agent_work, then say exactly: "${START_AGENT_WORK_PHRASE}" Do not call start_agent_work while you still need a critical clarification.`,
      tools: {
        show_custom_dataset_upload: llm.tool({
          description:
            "Show the custom dataset upload button when the user mentions a custom dataset, their own data, source data, spreadsheet, CSV, JSON, Excel file, or attaching/uploading data.",
          parameters: z.object({
            reason: z.string().optional(),
          }),
          execute: async () => {
            await ctx.room.localParticipant?.sendText(
              JSON.stringify({ type: "show_custom_dataset_upload" }),
              { topic: CUSTOM_DATASET_UPLOAD_TOPIC },
            );

            return "The custom dataset upload button is visible below the voice control.";
          },
        }),
        start_agent_work: llm.tool({
          description:
            "Use when the user is done explaining and wants the app to stop the voice conversation, summarize the request, and move to the agent work graph.",
          parameters: z.object({
            reason: z.string().optional(),
          }),
          execute: async () => {
            await ctx.room.localParticipant?.sendText(
              JSON.stringify({ type: "start_agent_work" }),
              { topic: START_AGENT_WORK_TOPIC },
            );

            return START_AGENT_WORK_PHRASE;
          },
        }),
      },
    });

    await session.start({
      agent,
      room: ctx.room,
      outputOptions: {
        syncTranscription: false,
      },
    });

    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);

    // Do not speak on join. The first audio should be a direct response to the user.
  },
});

if (process.argv[1] === currentFile) {
  delete process.env.LIVEKIT_AGENT_NAME;

  cli.runApp(
    new ServerOptions({
      agent: currentFile,
      wsURL: livekitUrl,
      apiKey: livekitApiKey,
      apiSecret: livekitApiSecret,
      agentName,
    }),
  );
}
