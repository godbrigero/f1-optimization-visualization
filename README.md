# F1 Optimization Visualization

Vercel-ready T3-style Next.js app scaffolded with TypeScript, Tailwind, tRPC,
TanStack Query, and LiveKit.

## Getting Started

Install dependencies and copy the environment template:

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`, then run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

Run the LiveKit voice worker in a second terminal when using `/speech`:

```bash
npm run agent:dev
```

The browser publishes microphone audio to a LiveKit room. The worker joins that
room, streams STT through LiveKit Inference, sends the turn to the DigitalOcean
OpenAI-compatible chat model, streams the response into Cartesia TTS through
LiveKit Inference, and publishes the returned audio back into the room.

## tRPC API

The app exposes a single tRPC endpoint at `/trpc`.

- `livekit.createToken` creates a LiveKit room token.
- `conversation.respond` sends a captured user utterance to the cheaper
  DigitalOcean model for non-LiveKit fallback flows.
- `conversation.summarize` sends the conversation to the summary model and
  returns the final implementation brief string.

Example LiveKit token request:

```bash
curl -X POST "http://localhost:3000/trpc/livekit.createToken" \
  -H "Content-Type: application/json" \
  -d '{
    "json": {
      "room": "race-strategy",
      "identity": "engineer-1",
      "name": "Race Engineer"
    }
  }'
```

## Environment Variables

- `LIVEKIT_URL`
- `NEXT_PUBLIC_LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `LIVEKIT_AGENT_STT_MODEL`
- `LIVEKIT_AGENT_TTS_MODEL`
- `LIVEKIT_AGENT_TTS_VOICE`
- `DIGITALOCEAN_MODEL_API_KEY`
- `DIGITALOCEAN_MODEL_BASE_URL`
- `DIGITALOCEAN_CHAT_MODEL`
- `DIGITALOCEAN_SUMMARY_MODEL`

## Deploy on Vercel

Import the repo in Vercel and add the same variables from `.env.example` to the
project's Environment Variables. The default `npm run build` command is already
compatible with Vercel's Next.js preset.
