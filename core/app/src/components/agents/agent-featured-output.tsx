"use client";

import { useState } from "react";
import { ExternalLink, FileText, Image as ImageIcon, Monitor, Smartphone } from "lucide-react";
import { AgentExampleMedia } from "./agent-example-media";
import { resolveAgentExamplePresentation } from "./agent-example-presentation";
import type { AgentExample } from "./types";

export function AgentFeaturedOutput({ agentId, examples }: { agentId: string; examples: AgentExample[] }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = examples[selectedIndex];
  if (!selected) return <div className="agent-example-empty">当前版本没有可公开展示的代表产物。</div>;
  const presentation = resolveAgentExamplePresentation(agentId, examples, String(selectedIndex + 1));
  if (!presentation) return <div className="agent-example-empty">当前代表产物无法打开，请重新选择。</div>;
  const mobile = presentation.device === "mobile";

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
        <div className="agent-example-stage-actions">
          <span className="agent-example-device">{mobile ? <Smartphone aria-hidden="true" /> : <Monitor aria-hidden="true" />}{mobile ? "移动端作品" : "桌面端作品"}</span>
          {presentation.preview ? <a href={presentation.preview} target="_blank" rel="noreferrer" aria-label={`在默认浏览器中查看${selected.title}`}><ExternalLink aria-hidden="true" />浏览器查看</a> : null}
        </div>
      </header>
      <div className="agent-example-canvas">
        <AgentExampleMedia presentation={presentation} />
      </div>
    </section>
  </div>;
}
