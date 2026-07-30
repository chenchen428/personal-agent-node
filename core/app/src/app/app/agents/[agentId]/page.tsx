import { AgentProfilePage } from "@/components/desktop-v627/agent-profile-page";

export default async function AgentDetailPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  return <AgentProfilePage agentId={decodeURIComponent(agentId)} />;
}
