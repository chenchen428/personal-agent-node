import { PageDetail } from "@/components/desktop-v627/page-detail";

export default async function PublishedPage({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  return <PageDetail pageId={decodeURIComponent(pageId)} />;
}
