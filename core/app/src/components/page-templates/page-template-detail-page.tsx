"use client";

import { Check, Monitor, ShieldCheck, Smartphone, Sparkles } from "lucide-react";
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PageTemplate } from "./catalog";
import { InteriorTemplatePreview } from "./interior-template-preview";

export function PageTemplateDetailPage({ template }: { template: PageTemplate }) {
  const [device, setDevice] = useState<"web" | "mobile">("web");
  return <main className="page-template-detail">
    <header className="template-detail-heading"><div><span>{template.category}</span><h1>{template.name}</h1><p>{template.summary}</p></div><span className="template-built-in"><i />已内置</span></header>
    <div className="template-detail-facts"><span><b>交付内容</b>SU 设计稿 · 户型图 · 用户需求</span><span><b>移动端</b>横屏触控布局</span><span><b>质量门槛</b>动线与生活可用性走查</span></div>
    <section className="template-live-preview"><header><div><b>交互示例</b><span>{device === "mobile" ? "移动横屏 · 触控布局" : "桌面 · 完整交付"}</span></div><Tabs value={device} onValueChange={(value) => setDevice(value as "web" | "mobile")}><TabsList className="template-device-switch" aria-label="切换模板预览设备"><TabsTrigger value="web"><Monitor aria-hidden="true" />Web</TabsTrigger><TabsTrigger value="mobile"><Smartphone aria-hidden="true" />移动端</TabsTrigger></TabsList></Tabs></header><InteriorTemplatePreview device={device} /></section>
    <section className="template-detail-information">
      <article><span>关联技能</span><h2><Sparkles aria-hidden="true" />{template.skill}</h2><p>读取用户给出的户型图和持续迭代的需求，生成可核对的 SketchUp 式空间方案。</p></article>
      <article><span>固定交付框架</span><ul>{template.fixedFramework.map((item) => <li key={item}><Check aria-hidden="true" />{item}</li>)}</ul></article>
      <article><span>交付前走查</span><h2><ShieldCheck aria-hidden="true" />生活可用性</h2><p>检查门窗开启、柜体阻挡、通行净宽、家具重叠、生活动线与移动端标注，发现阻塞项必须修复后才能交付。</p></article>
    </section>
  </main>;
}
