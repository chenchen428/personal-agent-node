import { AgentProfilePage } from "@/components/agents/agent-profile-page";

export default async function Page({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  return <AgentProfilePage agentId={agentId} />;
}
