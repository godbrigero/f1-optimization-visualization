import { z } from "zod";
import { getLlmProvider } from "@/lib/llm";
import type { LlmMessage } from "@/lib/llm";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1),
});

export const llmRouter = createTRPCRouter({
  chat: publicProcedure
    .input(
      z.object({
        provider: z.string().optional(),
        model: z.string().trim().min(1).optional(),
        messages: z.array(messageSchema).min(1),
        temperature: z.number().min(0).max(2).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const provider = getLlmProvider(input.provider);

      return provider.generateChat({
        model: input.model,
        messages: input.messages as LlmMessage[],
        temperature: input.temperature,
      });
    }),
});
