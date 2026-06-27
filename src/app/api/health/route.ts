import { optionalEnv } from "@/lib/env";
import { getMongoConnection } from "@/lib/mongodb";

export const runtime = "nodejs";

export async function GET() {
  const services = {
    mongodb: {
      configured: Boolean(optionalEnv("MONGODB_URI")),
      ok: false,
    },
    livekit: {
      configured: Boolean(
        optionalEnv("LIVEKIT_URL") &&
          optionalEnv("LIVEKIT_API_KEY") &&
          optionalEnv("LIVEKIT_API_SECRET")
      ),
    },
    digitalOcean: {
      configured: Boolean(optionalEnv("DIGITALOCEAN_MODEL_ACCESS_KEY")),
      model: optionalEnv("DIGITALOCEAN_MODEL"),
    },
  };

  if (services.mongodb.configured) {
    try {
      const { db } = await getMongoConnection();
      await db.admin().ping();
      services.mongodb.ok = true;
    } catch {
      services.mongodb.ok = false;
    }
  }

  return Response.json({
    ok:
      (!services.mongodb.configured || services.mongodb.ok) &&
      services.livekit.configured &&
      services.digitalOcean.configured,
    services,
  });
}
