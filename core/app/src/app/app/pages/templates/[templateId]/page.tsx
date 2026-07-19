import { notFound } from "next/navigation";
import { findPageTemplate } from "@/components/page-templates/catalog";
import { PageTemplateDetailPage } from "@/components/page-templates/page-template-detail-page";

export default async function TemplateDetail({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const template = findPageTemplate(decodeURIComponent(templateId));
  if (!template) notFound();
  return <PageTemplateDetailPage template={template} />;
}
