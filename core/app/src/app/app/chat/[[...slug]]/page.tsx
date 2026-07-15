import { ChatDashboard } from "@/components/chat-dashboard";

export default async function ChatPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = await params;
  const initialSessionId = slug[0] === "session" ? decodeURIComponent(slug[1] || "") : "";
  return <ChatDashboard initialSessionId={initialSessionId} />;
}
