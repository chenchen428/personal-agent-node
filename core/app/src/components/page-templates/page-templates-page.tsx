import Link from "next/link";
import { ArrowUpRight, Box, Smartphone, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pageTemplates } from "./catalog";
import { TemplateCardArtwork } from "./template-card-artwork";

export function PageTemplatesPage() {
  return <main className="page-template-page">
    <header className="page-template-heading"><div><h1>发布页模板</h1><p>选择一个稳定的交付结构，具体内容、户型与用户需求仍由 Agent 按本次任务生成。</p></div><span className="template-count">{pageTemplates.length} 个内置模板</span></header>
    <div className="page-template-grid">{pageTemplates.map((template) => <article className="page-template-card" key={template.id}>
      <TemplateCardArtwork />
      <div className="page-template-card-copy">
        <div className="page-template-card-meta"><span>已内置</span><small>{template.category}</small></div>
        <h2>{template.name}</h2><p>{template.summary}</p>
        <ul><li><Box aria-hidden="true" />SketchUp 式完整 SU 设计稿</li><li><Smartphone aria-hidden="true" />桌面与移动横屏独立体验</li><li><Sparkles aria-hidden="true" />户型图、需求与质量走查一体交付</li></ul>
        <Button asChild className="page-template-detail-action"><Link href={`/app/pages/templates/${template.id}`}>查看模板<ArrowUpRight aria-hidden="true" /></Link></Button>
      </div>
    </article>)}</div>
  </main>;
}
