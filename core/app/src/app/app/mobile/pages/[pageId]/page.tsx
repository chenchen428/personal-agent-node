import { MobilePages } from "@/components/mobile-current";
export default async function MobilePageDetail({ params }: { params: Promise<{ pageId: string }> }) { const { pageId } = await params; return <MobilePages pageId={pageId} />; }
