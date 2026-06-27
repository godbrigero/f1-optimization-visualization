import "server-only";

import { AccessToken } from "livekit-server-sdk";
import { getLiveKitEnv } from "@/lib/env";

export type CreateLiveKitTokenInput = {
  identity: string;
  room: string;
  name?: string;
  metadata?: string;
  canPublish?: boolean;
  canSubscribe?: boolean;
};

export async function createLiveKitRoomToken({
  identity,
  room,
  name,
  metadata,
  canPublish = true,
  canSubscribe = true,
}: CreateLiveKitTokenInput) {
  const { apiKey, apiSecret, url } = getLiveKitEnv();
  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    name,
    metadata,
    ttl: "1h",
  });

  token.addGrant({
    room,
    roomJoin: true,
    canPublish,
    canSubscribe,
  });

  return {
    token: await token.toJwt(),
    url,
  };
}
