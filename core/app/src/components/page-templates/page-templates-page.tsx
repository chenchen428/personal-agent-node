import Link from "next/link";
import { ArrowUpRight, Eye, Monitor, Smartphone } from "lucide-react";
import { Badge, PageHeader, PageSurface } from "@/components/desktop-v72/primitives";
import { pageTemplates } from "./catalog";
import { TemplateCardArtwork } from "./template-card-artwork";

export function PageTemplatesPage() {
  return <PageSurface className="page-template-catalog" width="wide">
    <PageHeader
      title="发布页模板"
      description="选择一个稳定的交付结构，具体内容、户型与用户需求仍由 Agent 按本次任务生成。"
      actions={<span className="template-catalog-count">{pageTemplates.length} 个内置模板</span>}
    />
    <section className="template-card-grid" aria-label="发布页模板列表">
      {pageTemplates.map((template) => <article className="template-mini-card" key={template.id}>
        <Link aria-label={`查看${template.name}`} className="template-mini-preview" href={`/app/pages/templates/${template.id}`} prefetch>
          <TemplateCardArtwork />
          <span><Eye aria-hidden="true" />进入详情</span>
        </Link>
        <div className="template-mini-body">
          <header><Badge tone="success">已内置</Badge><span>{template.category}</span></header>
          <h2>{template.name}</h2>
          <p>{template.summary}</p>
          <div className="template-mini-devices"><span><Monitor aria-hidden="true" />Web</span><span><Smartphone aria-hidden="true" />移动横屏</span></div>
          <Link href={`/app/pages/templates/${template.id}`} prefetch>查看模板<ArrowUpRight aria-hidden="true" /></Link>
        </div>
      </article>)}
    </section>
  </PageSurface>;
}
