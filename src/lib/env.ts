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

export function getMongoEnv() {
  return {
    uri: requireEnv("MONGODB_URI"),
    dbName: optionalEnv("MONGODB_DB"),
  };
}

export function getLiveKitEnv() {
  return {
    url: requireEnv("LIVEKIT_URL"),
    apiKey: requireEnv("LIVEKIT_API_KEY"),
    apiSecret: requireEnv("LIVEKIT_API_SECRET"),
  };
}

export function getDigitalOceanEnv() {
  return {
    apiKey: requireEnv("DIGITALOCEAN_MODEL_ACCESS_KEY"),
    baseURL:
      optionalEnv("DIGITALOCEAN_INFERENCE_BASE_URL") ??
      "https://inference.do-ai.run/v1/",
    model: optionalEnv("DIGITALOCEAN_MODEL") ?? "llama3.3-70b-instruct",
  };
}
