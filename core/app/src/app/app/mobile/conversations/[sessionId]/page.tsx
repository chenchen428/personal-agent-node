import { MobileWorkers } from "@/components/mobile-current";
export default async function MobileConversationPage({ params }: { params: Promise<{ sessionId: string }> }) { const { sessionId } = await params; return <MobileWorkers sessionId={sessionId} />; }
