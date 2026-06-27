import { livekitRouter } from "@/server/trpc/routers/livekit";
import { createTRPCRouter } from "@/server/trpc/trpc";

export const appRouter = createTRPCRouter({
  livekit: livekitRouter,
});

export type AppRouter = typeof appRouter;
