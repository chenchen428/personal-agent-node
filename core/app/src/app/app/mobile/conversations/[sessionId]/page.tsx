import { MobileConversationReader } from "@/components/mobile-conversation-reader";
export default async function MobileConversationPage({ params }: { params: Promise<{ sessionId: string }> }) { const { sessionId } = await params; return <MobileConversationReader initialSessionId={sessionId} />; }
