"use client";

import { useState } from "react";
import { FileText, Image as ImageIcon, Monitor, Smartphone } from "lucide-react";
import type { AgentExample } from "./types";

const featuredRoutes: Record<string, {
  preview: string;
  device: "desktop" | "mobile";
  media?: "iframe" | "video";
  poster?: string;
}> = {
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

export function AgentFeaturedOutput({ agentId, examples }: { agentId: string; examples: AgentExample[] }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = examples[selectedIndex];
  if (!selected) return <div className="agent-example-empty">当前版本没有可公开展示的代表产物。</div>;
  const fallback = featuredRoutes[agentId];
  const mobile = (selected.device || fallback?.device) === "mobile";
  const preview = selected.preview || fallback?.preview;

  return <div className="agent-featured-output">
    <div className="agent-example-list" role="tablist" aria-label="代表产物">
      {examples.map((example, index) => <button
        aria-selected={index === selectedIndex}
        className={index === selectedIndex ? "is-active" : ""}
        onClick={() => setSelectedIndex(index)}
        role="tab"
        type="button"
        key={`${example.title}-${index}`}
      >
        {example.kind === "image" ? <ImageIcon aria-hidden="true" /> : <FileText aria-hidden="true" />}
        <span><strong>{example.title}</strong><small>{example.description || example.summary}</small></span>
      </button>)}
    </div>
    <section className={`agent-example-stage ${mobile ? "is-mobile" : "is-desktop"}`} aria-label={selected.title}>
      <header>
        <div><span>{selected.kind || "专业交付示例"}</span><strong>{selected.title}</strong></div>
        <span className="agent-example-device">{mobile ? <Smartphone aria-hidden="true" /> : <Monitor aria-hidden="true" />}{mobile ? "移动端作品" : "桌面端作品"}</span>
      </header>
      <div className="agent-example-canvas">
        {preview && fallback?.media === "video"
          ? <video controls playsInline poster={fallback.poster} preload="metadata" src={preview} />
          : preview
            ? <iframe title={selected.title} src={preview} sandbox="allow-scripts allow-same-origin" />
            : <div className="agent-example-placeholder"><FileText aria-hidden="true" /><strong>{selected.title}</strong><p>{selected.description || selected.summary}</p></div>}
      </div>
    </section>
  </div>;
}
