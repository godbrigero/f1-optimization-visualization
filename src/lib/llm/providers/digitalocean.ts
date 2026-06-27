import "server-only";

import OpenAI from "openai";
import { getDigitalOceanEnv } from "@/lib/env";
import type {
  GenerateChatInput,
  GenerateChatResult,
  LlmProvider,
} from "@/lib/llm/types";

let client: OpenAI | undefined;

function getClient() {
  if (!client) {
    const { apiKey, baseURL } = getDigitalOceanEnv();

    client = new OpenAI({
      apiKey,
      baseURL,
    });
  }

  return client;
}

export const digitalOceanLlmProvider: LlmProvider = {
  name: "digitalocean",
  async generateChat({
    messages,
    model,
    temperature = 0.3,
  }: GenerateChatInput): Promise<GenerateChatResult> {
    const env = getDigitalOceanEnv();
    const resolvedModel = model ?? env.model;
    const completion = await getClient().chat.completions.create({
      model: resolvedModel,
      messages,
      temperature,
    });

    return {
      provider: "digitalocean",
      model: resolvedModel,
      content: completion.choices[0]?.message.content ?? "",
      usage: completion.usage
        ? {
            promptTokens: completion.usage.prompt_tokens,
            completionTokens: completion.usage.completion_tokens,
            totalTokens: completion.usage.total_tokens,
          }
        : undefined,
    };
  },
};
