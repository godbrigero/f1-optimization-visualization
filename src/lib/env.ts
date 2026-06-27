import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : undefined;
}

export function requireEnv(name: string): string {
  const parsed = nonEmptyString.safeParse(process.env[name]);

  if (!parsed.success) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return parsed.data;
}

export function getLiveKitEnv() {
  return {
    url: requireEnv("LIVEKIT_URL"),
    apiKey: requireEnv("LIVEKIT_API_KEY"),
    apiSecret: requireEnv("LIVEKIT_API_SECRET"),
  };
}
