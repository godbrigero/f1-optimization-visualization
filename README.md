# F1 Optimization Visualization

Vercel-ready T3-style Next.js app scaffolded with TypeScript, Tailwind, tRPC,
TanStack Query, MongoDB, LiveKit, and a modular LLM provider layer for
DigitalOcean model calls.

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

## tRPC API

The app exposes a single tRPC endpoint at `/api/trpc`.

- `health.check` checks configured services and pings MongoDB when configured.
- `livekit.createToken` creates a LiveKit room token.
- `llm.chat` calls the configured LLM provider.

Example raw tRPC LLM request:

```bash
curl -X POST "http://localhost:3000/api/trpc/llm.chat" \
  -H "Content-Type: application/json" \
  -d '{
    "json": {
      "messages": [
        { "role": "user", "content": "Summarize this F1 stint strategy in one sentence." }
      ]
    }
  }'
```

Example LiveKit token request:

```bash
curl -X POST "http://localhost:3000/api/trpc/livekit.createToken" \
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

- `MONGODB_URI`
- `MONGODB_DB`
- `LIVEKIT_URL`
- `NEXT_PUBLIC_LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `DIGITALOCEAN_MODEL_ACCESS_KEY`
- `DIGITALOCEAN_INFERENCE_BASE_URL`
- `DIGITALOCEAN_MODEL`
- `LLM_PROVIDER`

## LLM Providers

Provider routing lives in `src/lib/llm`. The tRPC procedure `llm.chat` calls the
configured provider. The current default provider is `digitalocean`, implemented
with the OpenAI-compatible SDK client against DigitalOcean's inference base URL.

Add future providers by implementing `LlmProvider`, registering it in
`src/lib/llm/index.ts`, and setting `LLM_PROVIDER`.

## Deploy on Vercel

Import the repo in Vercel and add the same variables from `.env.example` to the
project's Environment Variables. The default `npm run build` command is already
compatible with Vercel's Next.js preset.
