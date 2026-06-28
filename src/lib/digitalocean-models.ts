import "server-only";

import { getDigitalOceanModelEnv } from "@/lib/env";

export type ConversationMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type DigitalOceanChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

type DigitalOceanModelsResponse = {
  data?: Array<{
    id?: string;
  }>;
};

type DigitalOceanSpeechResponse = {
  data?: Array<{
    b64_json?: string;
  }>;
};

const chatModelFallbacks = [
  "openai-gpt-5.4-nano",
  "openai-gpt-4o-mini",
  "qwen3-coder-flash",
  "openai-gpt-oss-20b",
  "mistral-3-14B",
];

const summaryModelFallbacks = [
  "alibaba-qwen3-32b",
  "llama3.3-70b-instruct",
  "openai-gpt-oss-20b",
  "llama-4-maverick",
  "mistral-3-14B",
];

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

async function listAvailableModels() {
  const { apiKey, baseUrl } = getDigitalOceanModelEnv();
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as DigitalOceanModelsResponse;

  return data.data?.map((model) => model.id).filter((id): id is string => Boolean(id)) ?? [];
}

async function resolveAvailableModel(model: string, fallbacks: string[]) {
  const availableModels = await listAvailableModels();

  if (availableModels.length === 0 || availableModels.includes(model)) {
    return model;
  }

  const fallback = fallbacks.find((candidate) => availableModels.includes(candidate));

  if (fallback) {
    return fallback;
  }

  throw new Error(
    `DigitalOcean model "${model}" is not available. Available models: ${availableModels.join(", ")}`,
  );
}

async function completeWithDigitalOcean({
  fallbacks,
  messages,
  model,
  temperature = 0.3,
}: {
  fallbacks: string[];
  messages: ConversationMessage[];
  model: string;
  temperature?: number;
}) {
  const { apiKey, baseUrl } = getDigitalOceanModelEnv();
  const resolvedModel = await resolveAvailableModel(model, fallbacks);
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: resolvedModel,
      messages,
      temperature,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `DigitalOcean model request failed (${response.status}): ${
        errorBody || response.statusText
      }`,
    );
  }

  const data = (await response.json()) as DigitalOceanChatResponse;
  const content = data.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("DigitalOcean model response did not include text.");
  }

  return content;
}

export async function continueConversation(messages: ConversationMessage[]) {
  const { chatModel } = getDigitalOceanModelEnv();

  return completeWithDigitalOcean({
    fallbacks: chatModelFallbacks,
    model: chatModel,
    temperature: 0.45,
    messages: [
      {
        role: "system",
        content:
          "You are a concise voice agent. Ask short clarifying questions when needed. Keep responses conversational and under 60 words.",
      },
      ...messages,
    ],
  });
}

export async function summarizeConversation(messages: ConversationMessage[]) {
  const { summaryModel } = getDigitalOceanModelEnv();

  return completeWithDigitalOcean({
    fallbacks: summaryModelFallbacks,
    model: summaryModel,
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content:
          "Summarize what the user wants as one direct implementation brief string. Include concrete requirements, constraints, and data context. Do not include markdown.",
      },
      {
        role: "user",
        content: messages
          .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
          .join("\n"),
      },
    ],
  });
}

export async function synthesizeSpeech(input: string) {
  const { apiKey, baseUrl, ttsInstructions, ttsModel, ttsVoice } = getDigitalOceanModelEnv();
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: ttsModel,
      input,
      voice: ttsVoice,
      response_format: "mp3",
      instructions: ttsInstructions,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `DigitalOcean TTS request failed (${response.status}): ${errorBody || response.statusText}`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("audio/")) {
    const audioBuffer = await response.arrayBuffer();

    return Buffer.from(audioBuffer).toString("base64");
  }

  const data = (await response.json()) as DigitalOceanSpeechResponse;
  const audioBase64 = data.data?.[0]?.b64_json;

  if (!audioBase64) {
    throw new Error("DigitalOcean TTS response did not include audio.");
  }

  return audioBase64;
}
