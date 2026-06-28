import type { Metadata } from "next";
import { ViewTransition } from "react";

import { AgentGraph } from "@/components/agent-graph";

export const metadata: Metadata = {
  title: "Agent Network | F1 Optimization Visualization",
  description: "A modern monochrome pipeline graph of interconnected agents.",
};

export default function AgentsPage() {
  return (
    <ViewTransition
      enter={{ "nav-forward": "nav-forward", default: "none" }}
      exit={{ "nav-forward": "nav-forward", default: "none" }}
      default="none"
    >
      <AgentGraph />
    </ViewTransition>
  );
}
