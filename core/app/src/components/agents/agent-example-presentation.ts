import type { AgentExample } from "./types";

type FeaturedRoute = {
  preview: string;
  device: "desktop" | "mobile";
  media?: "iframe" | "video";
  poster?: string;
};

export type AgentExamplePresentation = {
  example: AgentExample;
  exampleId: string;
  preview?: string;
  device: "desktop" | "mobile";
  media: "iframe" | "video";
  poster?: string;
};

const featuredRoutes: Record<string, FeaturedRoute> = {
  "finance-analyst": { preview: "/assets/agents/finance-analyst/featured/index.html", device: "desktop" },
  "interior-designer": { preview: "/assets/agents/interior-designer/featured/index.html", device: "desktop" },
  "poster-designer": { preview: "/assets/agents/poster-designer/featured/index.html", device: "mobile" },
  "travel-planner": { preview: "/assets/agent-examples/travel-planning-fuzhou-v1/index.html", device: "desktop" },
  "video-creator": {
    preview: "/assets/agent-examples/personal-agent-intro-v1/personal-agent-intro.mp4",
    device: "desktop",
    media: "video",
    poster: "/assets/agent-examples/personal-agent-intro-v1/poster.jpg",
  },
};

export function agentExampleHref(agentId: string, exampleId: string) {
  return `/app/agents/${encodeURIComponent(agentId)}/examples/${encodeURIComponent(exampleId)}`;
}

export function resolveAgentExamplePresentation(
  agentId: string,
  examples: AgentExample[],
  exampleId: string,
): AgentExamplePresentation | null {
  if (!/^[1-9]\d*$/.test(exampleId)) return null;
  const index = Number(exampleId) - 1;
  const example = Number.isSafeInteger(index) ? examples[index] : undefined;
  if (!example) return null;

  const fallback = featuredRoutes[agentId];
  const preview = safeSameOriginPath(example.preview || fallback?.preview);
  const media = fallback?.media || (preview?.toLowerCase().endsWith(".mp4") ? "video" : "iframe");
  return {
    example,
    exampleId,
    preview,
    device: example.device || fallback?.device || "desktop",
    media,
    poster: safeSameOriginPath(fallback?.poster),
  };
}

function safeSameOriginPath(value?: string) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : undefined;
}
