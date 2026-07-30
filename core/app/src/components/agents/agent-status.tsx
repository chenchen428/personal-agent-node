import { Badge } from "@/components/desktop-v72/primitives";
import { agentStatusPresentation, type AgentStatus } from "./types";

export function AgentStatusBadge({ status }: { status: AgentStatus }) {
  const presentation = agentStatusPresentation[status];
  return <Badge tone={presentation.tone} className="agent-status-badge">
    <i className={`status-dot ${status === "available" ? "success" : status === "updating" ? "warning" : "danger"}`} />
    {presentation.label}
  </Badge>;
}
