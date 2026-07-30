import Link from "next/link";
import { ArrowUpRight, Brush, ChartNoAxesCombined, Map, Sofa } from "lucide-react";
import { AgentStatusBadge } from "./agent-status";
import type { AgentDirectoryItem } from "./types";

const icons = {
  "finance-analyst": ChartNoAxesCombined,
  "interior-designer": Sofa,
  "poster-designer": Brush,
  "travel-planner": Map,
};

export function AgentCard({ agent, index }: { agent: AgentDirectoryItem; index: number }) {
  const Icon = icons[agent.id as keyof typeof icons] || Brush;
  const color = agent.profile.visualIdentity?.accent || agent.profile.visualIdentity?.color || "#5f6f66";
  return <Link
    className="agent-directory-card"
    href={`/app/agents/${encodeURIComponent(agent.id)}`}
    style={{ "--agent-color": color } as React.CSSProperties}
  >
    <header>
      <span className="agent-directory-icon"><Icon aria-hidden="true" /></span>
      <span className="agent-directory-index">{String(index + 1).padStart(2, "0")}</span>
      <AgentStatusBadge status={agent.status} />
    </header>
    <div className="agent-directory-copy">
      <span>{agent.profile.overview.role}</span>
      <h2>{agent.displayName}</h2>
      <p>{agent.profile.overview.tagline}</p>
    </div>
    <div className="agent-directory-capabilities">
      {agent.profile.capabilities.slice(0, 2).map((capability) => <span key={capability.title}>{capability.title}</span>)}
    </div>
    <footer>
      <span>{agent.profile.capabilities.length} 项能力 · {agent.profile.deliverables.length} 类产出</span>
      <strong aria-hidden="true"><ArrowUpRight /></strong>
    </footer>
  </Link>;
}
