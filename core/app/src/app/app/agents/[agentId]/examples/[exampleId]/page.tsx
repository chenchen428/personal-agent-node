import { AgentExamplePage } from "@/components/agents/agent-example-page";

export default async function Page({ params }: {
  params: Promise<{ agentId: string; exampleId: string }>;
}) {
  const { agentId, exampleId } = await params;
  return <AgentExamplePage agentId={agentId} exampleId={exampleId} />;
}
