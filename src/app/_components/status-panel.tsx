"use client";

import { api } from "@/trpc/react";

export function StatusPanel() {
  const health = api.health.check.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  if (health.isLoading) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5 text-sm text-neutral-300">
        Checking service configuration...
      </div>
    );
  }

  if (health.isError) {
    return (
      <div className="rounded-lg border border-red-400/30 bg-red-950/30 p-5 text-sm text-red-100">
        {health.error.message}
      </div>
    );
  }

  if (!health.data) {
    return null;
  }

  const services = health.data.services;

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">tRPC health check</h2>
        <span
          className={
            health.data.ok
              ? "text-sm font-medium text-emerald-300"
              : "text-sm font-medium text-amber-300"
          }
        >
          {health.data.ok ? "Ready" : "Needs env"}
        </span>
      </div>
      <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-neutral-400">MongoDB</dt>
          <dd className="mt-1 text-neutral-100">
            {services.mongodb.configured
              ? services.mongodb.ok
                ? "Connected"
                : "Configured"
              : "Missing env"}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-400">LiveKit</dt>
          <dd className="mt-1 text-neutral-100">
            {services.livekit.configured ? "Configured" : "Missing env"}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-400">DigitalOcean</dt>
          <dd className="mt-1 text-neutral-100">
            {services.digitalOcean.configured ? "Configured" : "Missing env"}
          </dd>
        </div>
      </dl>
    </div>
  );
}
