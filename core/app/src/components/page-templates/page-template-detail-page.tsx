"use client";

import Link from "next/link";
import { Check, Monitor, Smartphone, Sparkles } from "lucide-react";
import { useState } from "react";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PageTemplate } from "./catalog";
import { InteriorTemplatePreview } from "./interior-template-preview";

export function PageTemplateDetailPage({ template }: { template: PageTemplate }) {
  const [device, setDevice] = useState<"web" | "mobile">("web");
  return <main className="page-template-detail">
    <Breadcrumb><BreadcrumbList><BreadcrumbItem><Link href="/app/pages">发布页</Link></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><Link href="/app/pages/templates">模板</Link></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>{template.name}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>
    <header className="template-detail-heading"><div><span>{template.category}</span><h1>{template.name}</h1><p>{template.summary}</p></div><span className="template-built-in"><i />已内置</span></header>
    <section className="template-live-preview"><header><div><b>LIVE PREVIEW</b><span>{device === "mobile" ? "移动端 · 默认横屏" : "Web · 完整展示"}</span></div><Tabs value={device} onValueChange={(value) => setDevice(value as "web" | "mobile")}><TabsList className="template-device-switch" aria-label="切换模板预览设备"><TabsTrigger value="web"><Monitor aria-hidden="true" />Web</TabsTrigger><TabsTrigger value="mobile"><Smartphone aria-hidden="true" />移动端</TabsTrigger></TabsList></Tabs></header><InteriorTemplatePreview device={device} /></section>
    <section className="template-detail-information">
      <article><span>关联技能</span><h2><Sparkles aria-hidden="true" />{template.skill}</h2><p>读取户型和风格参考，建立带精度说明的概念模型，并使用本模板生成可旋转的装修设计交付页。</p></article>
      <article><span>固定交付框架</span><ul>{template.fixedFramework.map((item) => <li key={item}><Check aria-hidden="true" />{item}</li>)}</ul></article>
      <article><span>Agent 自由发挥</span><ul>{template.agentFreedom.map((item) => <li key={item}><Check aria-hidden="true" />{item}</li>)}</ul></article>
    </section>
  </main>;
}
