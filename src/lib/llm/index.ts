import "server-only";

import { optionalEnv } from "@/lib/env";
import { digitalOceanLlmProvider } from "@/lib/llm/providers/digitalocean";
import type { LlmProvider, LlmProviderName } from "@/lib/llm/types";

const providers = {
  digitalocean: digitalOceanLlmProvider,
} satisfies Record<LlmProviderName, LlmProvider>;

export function getLlmProvider(name?: string): LlmProvider {
  const providerName = (name ?? optionalEnv("LLM_PROVIDER") ?? "digitalocean") as
    | LlmProviderName
    | string;

  if (providerName in providers) {
    return providers[providerName as LlmProviderName];
  }

  throw new Error(`Unsupported LLM provider: ${providerName}`);
}

export type { GenerateChatInput, LlmMessage, LlmProviderName } from "./types";
