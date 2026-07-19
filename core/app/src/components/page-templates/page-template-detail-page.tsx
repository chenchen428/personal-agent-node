"use client";

import Link from "next/link";
import { ArrowLeft, Check, Monitor, Smartphone, Sparkles } from "lucide-react";
import { useState } from "react";
import type { PageTemplate } from "./catalog";
import { InteriorTemplatePreview } from "./interior-template-preview";

export function PageTemplateDetailPage({ template }: { template: PageTemplate }) {
  const [device, setDevice] = useState<"web" | "mobile">("web");
  return <main className="page-template-detail">
    <header className="template-detail-heading"><Link href="/app/pages/templates"><ArrowLeft aria-hidden="true" />全部模板</Link><div><span>{template.category}</span><h1>{template.name}</h1><p>{template.summary}</p></div><span className="template-built-in"><i />已内置</span></header>
    <section className="template-live-preview"><header><div><b>LIVE PREVIEW</b><span>{device === "mobile" ? "移动端 · 默认横屏" : "Web · 完整展示"}</span></div><div className="template-device-switch" role="group" aria-label="切换模板预览设备"><button className={device === "web" ? "active" : ""} type="button" onClick={() => setDevice("web")}><Monitor aria-hidden="true" />Web</button><button className={device === "mobile" ? "active" : ""} type="button" onClick={() => setDevice("mobile")}><Smartphone aria-hidden="true" />移动端</button></div></header><InteriorTemplatePreview device={device} /></section>
    <section className="template-detail-information">
      <article><span>关联技能</span><h2><Sparkles aria-hidden="true" />{template.skill}</h2><p>读取户型和风格参考，建立带精度说明的概念模型，并使用本模板生成可旋转的装修设计交付页。</p></article>
      <article><span>固定交付框架</span><ul>{template.fixedFramework.map((item) => <li key={item}><Check aria-hidden="true" />{item}</li>)}</ul></article>
      <article><span>Agent 自由发挥</span><ul>{template.agentFreedom.map((item) => <li key={item}><Check aria-hidden="true" />{item}</li>)}</ul></article>
    </section>
  </main>;
}
