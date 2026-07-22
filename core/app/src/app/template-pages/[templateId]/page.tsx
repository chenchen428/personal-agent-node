import { notFound } from "next/navigation";
import { findPageTemplate } from "@/components/page-templates/catalog";
import { PageTemplateExamplePage } from "@/components/page-templates/page-template-example-page";

export default async function TemplateExample({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  if (!findPageTemplate(decodeURIComponent(templateId))) notFound();
  return <PageTemplateExamplePage />;
}
