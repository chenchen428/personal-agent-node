import type { ComponentType, ReactNode } from "react";
import { Bot, ChartNoAxesCombined, House, Images, MapPinned, Video } from "lucide-react";

const icons: Record<string, ComponentType<{ "aria-hidden"?: boolean }>> = {
  "video-creator": Video,
  "interior-designer": House,
  "travel-planner": MapPinned,
  "poster-designer": Images,
  "finance-analyst": ChartNoAxesCombined,
};

export function AgentGlyph({ agentId }: { agentId: string }) {
  const Icon = icons[agentId] || Bot;
  return <span className="agent-profile-glyph" data-agent-id={agentId}><Icon aria-hidden /></span>;
}

export function AgentTagList({ items, limit }: { items: string[]; limit?: number }) {
  const visible = typeof limit === "number" ? items.slice(0, limit) : items;
  const remaining = items.length - visible.length;
  return <div className="agent-tag-list">{visible.map((item) => <span key={item}>{item}</span>)}{remaining > 0 ? <span>+{remaining}</span> : null}</div>;
}

export function AgentProfileList({ title, icon, items }: { title: string; icon: ReactNode; items: string[] }) {
  return <section className="agent-profile-section">
    <h2><span>{icon}</span>{title}</h2>
    <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
  </section>;
}
