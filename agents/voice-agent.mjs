import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cli, defineAgent, inference, ServerOptions, voice } from "@livekit/agents";
import { LLM as OpenAILLM } from "@livekit/agents-plugin-openai";

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

const livekitUrl = requiredEnv("LIVEKIT_URL");
const livekitApiKey = requiredEnv("LIVEKIT_API_KEY");
const livekitApiSecret = requiredEnv("LIVEKIT_API_SECRET");
const digitalOceanApiKey = requiredEnv("DIGITALOCEAN_MODEL_API_KEY");
const digitalOceanBaseUrl = process.env.DIGITALOCEAN_MODEL_BASE_URL ?? "https://inference.do-ai.run/v1";
const chatModel = process.env.DIGITALOCEAN_CHAT_MODEL ?? "qwen3-coder-flash";
const sttModel = process.env.LIVEKIT_AGENT_STT_MODEL ?? "deepgram/flux-general-en";
const ttsModel = process.env.LIVEKIT_AGENT_TTS_MODEL ?? "cartesia/sonic-3.5";
const ttsVoice = process.env.LIVEKIT_AGENT_TTS_VOICE || "e2d48e7b-cc6d-4f97-a8fd-13c1449aeebd";
const agentId = process.env.LIVEKIT_AGENT_ID || "f1-voice-agent";

export default defineAgent({
  entry: async (ctx) => {
    await ctx.connect();

    const session = new voice.AgentSession({
      stt: new inference.STT({
        model: sttModel,
        language: "en",
        apiKey: livekitApiKey,
        apiSecret: livekitApiSecret,
        modelOptions: {
          eager_eot_threshold: 0.55,
          eot_timeout_ms: 900,
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
          max_buffer_delay_ms: optionalNumberEnv("LIVEKIT_AGENT_TTS_MAX_BUFFER_DELAY_MS", 120),
        },
      }),
      aecWarmupDuration: 400,
      turnHandling: {
        preemptiveGeneration: {
          enabled: true,
          preemptiveTts: false,
          maxSpeechDuration: 8000,
          maxRetries: 3,
        },
        interruption: {
          enabled: false,
        },
        endpointing: {
          minDelay: 300,
          maxDelay: 1200,
        },
      },
      ttsTextTransforms: ["filter_markdown", "filter_emoji"],
    });

    const agent = new voice.Agent({
      id: agentId,
      instructions:
        "You are a fast voice agent for an F1 optimization app. Keep replies short, natural, and useful. Ask one clear follow-up when the user is vague. Do not mention implementation details unless asked.",
    });

    await session.start({
      agent,
      room: ctx.room,
    });

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
      agentName: "",
    }),
  );
}
