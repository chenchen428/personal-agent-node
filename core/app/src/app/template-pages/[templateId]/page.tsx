import { notFound, redirect } from "next/navigation";
import { findPageTemplate } from "@/components/page-templates/catalog";

export default async function TemplateExample({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const template = findPageTemplate(decodeURIComponent(templateId));
  if (!template) notFound();
  redirect(template.exampleArtifact.pagePath);
}
