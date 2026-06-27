import { StatusPanel } from "@/app/_components/status-panel";

export default function Home() {
  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100">
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-10">
        <div className="max-w-3xl">
          <p className="mb-3 text-sm font-medium uppercase text-cyan-300">
            T3-style Next.js starter
          </p>
          <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">
            F1 optimization visualization now runs through tRPC.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-neutral-300">
            MongoDB, LiveKit token generation, and DigitalOcean-hosted LLM calls
            are exposed through a typed T3-style router.
          </p>
        </div>

        <StatusPanel />

        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              title: "MongoDB",
              body: "Shared server client with connection reuse for Vercel functions.",
              endpoint: "health.check",
            },
            {
              title: "LiveKit",
              body: "POST room and identity data to mint short-lived join tokens.",
              endpoint: "livekit.createToken",
            },
            {
              title: "DigitalOcean LLM",
              body: "OpenAI-compatible provider adapter behind a modular LLM registry.",
              endpoint: "llm.chat",
            },
          ].map((item) => (
            <article
              className="rounded-lg border border-white/10 bg-white/[0.04] p-5"
              key={item.title}
            >
              <h2 className="text-lg font-semibold">{item.title}</h2>
              <p className="mt-3 text-sm leading-6 text-neutral-300">
                {item.body}
              </p>
              <code className="mt-5 block rounded bg-black/40 px-3 py-2 text-sm text-cyan-200">
                {item.endpoint}
              </code>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
