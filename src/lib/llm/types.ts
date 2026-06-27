import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export type LlmProviderName = "digitalocean";

export type LlmMessage = Extract<
  ChatCompletionMessageParam,
  { role: "system" | "user" | "assistant" }
>;

export type GenerateChatInput = {
  messages: LlmMessage[];
  model?: string;
  temperature?: number;
};

export type GenerateChatResult = {
  provider: LlmProviderName;
  model: string;
  content: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
};

export type LlmProvider = {
  name: LlmProviderName;
  generateChat(input: GenerateChatInput): Promise<GenerateChatResult>;
};
