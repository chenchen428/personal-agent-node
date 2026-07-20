import Link from "next/link";
import { ArrowRight, LayoutTemplate, Monitor, Smartphone, Sparkles } from "lucide-react";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { pageTemplates } from "./catalog";
import { TemplateCardArtwork } from "./template-card-artwork";

export function PageTemplatesPage() {
  return <main className="page-template-page">
    <Breadcrumb><BreadcrumbList><BreadcrumbItem><Link href="/app/pages">发布页</Link></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>模板</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>
    <header className="page-template-heading"><div><span>PAGES · TEMPLATE</span><h1>发布页模板</h1><p>从稳定的交付框架开始，再由 Agent 根据具体任务生成内容。</p></div></header>
    <section className="page-template-summary"><LayoutTemplate aria-hidden="true" /><div><span>当前精选</span><strong>{pageTemplates.length}</strong></div><p>模板只定义交付所需的信息层级、交互边界和设备适配；具体内容仍由 Agent 根据用户需求判断。</p></section>
    <div className="page-template-grid">{pageTemplates.map((template) => <article className="page-template-card" key={template.id}>
      <TemplateCardArtwork />
      <div className="page-template-card-copy"><div className="page-template-card-meta"><span>已内置</span><small>{template.category}</small></div><b>FEATURED TEMPLATE</b><h2>{template.name}</h2><p>{template.summary}</p>
        <ul><li><Monitor aria-hidden="true" />Web 完整展示</li><li><Smartphone aria-hidden="true" />移动端横屏查看</li><li><Sparkles aria-hidden="true" />Agent 自由生成细节</li></ul>
        <span className="page-template-skill">关联技能 <code>{template.skill}</code></span>
        <Button asChild className="page-template-detail-action"><Link href={`/app/pages/templates/${template.id}`}>查看模板详情<ArrowRight aria-hidden="true" /></Link></Button>
      </div>
    </article>)}</div>
  </main>;
}
