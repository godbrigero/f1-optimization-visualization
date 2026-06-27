import { healthRouter } from "@/server/api/routers/health";
import { livekitRouter } from "@/server/api/routers/livekit";
import { llmRouter } from "@/server/api/routers/llm";
import { createTRPCRouter } from "@/server/api/trpc";

export const appRouter = createTRPCRouter({
  health: healthRouter,
  livekit: livekitRouter,
  llm: llmRouter,
});

export type AppRouter = typeof appRouter;
