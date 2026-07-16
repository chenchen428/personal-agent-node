import { MobileMailDetail } from "@/components/mobile-current";
export default async function MobileMailPage({ params }: { params: Promise<{ messageId: string }> }) { const { messageId } = await params; return <MobileMailDetail messageId={messageId} />; }
